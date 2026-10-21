// Atomic Redis protocol scripts. Keep key/ARGV order and wire formats compatible.
const CACHE_SCRIPT = `
local expected = {'hash', 'zset', 'zset', 'hash', 'zset'}
for i, key in ipairs(KEYS) do
  local kind = redis.call('TYPE', key).ok
  if kind ~= 'none' and kind ~= expected[i] then return redis.error_reply('Unexpected cache key type') end
end
-- Redis eviction can remove one container without its companions. Never read
-- orphaned values or leases after losing the expiry/order/generation indexes.
local entries = redis.call('HLEN', KEYS[1])
local order = redis.call('ZCARD', KEYS[3])
if redis.call('ZCARD', KEYS[2]) ~= order or entries ~= (order > 0 and order + 1 or 0) then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
end
if redis.call('HLEN', KEYS[4]) ~= redis.call('ZCARD', KEYS[5]) then
  redis.call('DEL', KEYS[4], KEYS[5])
end
local r = cjson.decode(ARGV[1])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000
local function removeEntry(key)
  local removed = redis.call('HDEL', KEYS[1], 'e:' .. key)
  redis.call('ZREM', KEYS[2], key)
  redis.call('ZREM', KEYS[3], key)
  return removed
end
local function removeMeta(field)
  redis.call('HDEL', KEYS[4], field)
  redis.call('ZREM', KEYS[5], field)
end
for _, key in ipairs(redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, r.capacity)) do removeEntry(key) end
for _, field in ipairs(redis.call('ZRANGEBYSCORE', KEYS[5], '-inf', now, 'LIMIT', 0, r.metadataLimit)) do removeMeta(field) end
local function expireContainers()
  local last = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  if #last == 0 then
    redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
  elseif last[2] == 'inf' then
    for i = 1, 3 do redis.call('PERSIST', KEYS[i]) end
  else
    local ttl = math.max(1, math.ceil(tonumber(last[2]) - now))
    for i = 1, 3 do redis.call('PEXPIRE', KEYS[i], ttl) end
  end
  for i = 4, 5 do redis.call('PEXPIRE', KEYS[i], r.metadataTtlMs) end
end
local function response(value)
  expireContainers()
  return cjson.encode(value)
end
local function addTags(existing, added)
  local seen = {}
  local result = {}
  for _, tags in ipairs({existing, added}) do
    for _, tag in ipairs(tags) do
      if not seen[tag] then seen[tag] = true; table.insert(result, tag) end
    end
  end
  if #result > 32 then error('Cache entries support at most 32 tags') end
  return result
end
local function touch(key)
  local sequence = redis.call('HINCRBY', KEYS[1], '_sequence', 1)
  redis.call('ZADD', KEYS[3], sequence, key)
end
local function read(key, tags)
  local raw = redis.call('HGET', KEYS[1], 'e:' .. key)
  if not raw then return nil end
  local entry = cjson.decode(raw)
  if #tags > 0 then
    entry.tags = addTags(entry.tags, tags)
    redis.call('HSET', KEYS[1], 'e:' .. key, cjson.encode(entry))
  end
  touch(key)
  return entry.payload
end
local function write(key, payload, tags)
  local entry = {payload=payload, tags=tags}
  redis.call('HSET', KEYS[1], 'e:' .. key, cjson.encode(entry))
  redis.call('ZADD', KEYS[2], r.ttlMs == 0 and '+inf' or now + r.ttlMs, key)
  touch(key)
  local overflow = redis.call('ZCARD', KEYS[3]) - r.capacity
  if overflow > 0 then
    for _, victim in ipairs(redis.call('ZRANGE', KEYS[3], 0, overflow - 1)) do removeEntry(victim) end
  end
end
local leaseField = 'l:' .. r.key
local function lease()
  local raw = redis.call('HGET', KEYS[4], leaseField)
  if not raw then return nil end
  local value = cjson.decode(raw)
  if value.expires <= now or value.deadline <= now then removeMeta(leaseField); return nil end
  return value
end
local function metadataSpace(count)
  if redis.call('HLEN', KEYS[4]) + count > r.metadataLimit then
    -- Pressure sheds generation/lease state. Every old owner is fenced; cached
    -- entries remain valid because invalidation removes matching entries atomically.
    redis.call('DEL', KEYS[4], KEYS[5])
  end
end
local function putMeta(field, value, expires)
  redis.call('HSET', KEYS[4], field, value)
  redis.call('ZADD', KEYS[5], expires, field)
end
local function scopes()
  local fields = {}
  for _, tag in ipairs(r.tags) do table.insert(fields, 'g:tag:' .. tag) end
  for _, prefix in ipairs(r.prefixes) do table.insert(fields, 'g:prefix:' .. prefix) end
  return fields
end
local function matches(key, tags)
  if r.op == 'invalidate' then return key == r.key end
  if r.op == 'prefix' then return key == r.key or string.sub(key, 1, #r.key + 1) == r.key .. '?' end
  if r.op == 'tags' then
    for _, existing in ipairs(tags) do
      for _, wanted in ipairs(r.tags) do if wanted == existing then return true end end
    end
  end
  return false
end
if r.op == 'clear' then
  redis.call('DEL', unpack(KEYS))
  return cjson.encode({removed=0})
elseif r.op == 'get' then
  local payload = read(r.key, r.tags)
  return response(payload and {kind='value', payload=payload} or {kind='missing'})
elseif r.op == 'set' then
  local old = redis.call('HGET', KEYS[1], 'e:' .. r.key)
  local tags = old and cjson.decode(old).tags or {}
  write(r.key, r.payload, tags)
  removeMeta(leaseField)
  return response({written=true})
elseif r.op == 'attach' then
  read(r.key, r.tags)
  return response({written=true})
elseif r.op == 'size' then
  return response({size=redis.call('ZCARD', KEYS[3])})
elseif r.op == 'tags' or r.op == 'prefix' or r.op == 'invalidate' then
  local generationFields = {}
  if r.op == 'tags' then
    for _, tag in ipairs(r.tags) do table.insert(generationFields, 'g:tag:' .. tag) end
  elseif r.op == 'prefix' then table.insert(generationFields, 'g:prefix:' .. r.key) end
  metadataSpace(#generationFields)
  for _, field in ipairs(generationFields) do putMeta(field, r.owner, now + r.metadataTtlMs) end
  local removed = 0
  for _, key in ipairs(redis.call('ZRANGE', KEYS[3], 0, -1)) do
    local raw = redis.call('HGET', KEYS[1], 'e:' .. key)
    if raw and matches(key, cjson.decode(raw).tags) then removed = removed + removeEntry(key) end
  end
  for _, field in ipairs(redis.call('HKEYS', KEYS[4])) do
    if string.sub(field, 1, 2) == 'l:' then
      local value = cjson.decode(redis.call('HGET', KEYS[4], field))
      if matches(string.sub(field, 3), value.tags) then removeMeta(field) end
    end
  end
  return response({removed=removed})
elseif r.op == 'claim' then
  local payload = read(r.key, r.tags)
  if payload then return response({kind='value', payload=payload}) end
  local current = lease()
  if current then
    local shared = addTags(current.tags, r.tags)
    if #shared == #current.tags then return response({kind='wait'}) end
    -- A newly requested tag must not inherit a fill started before that tag's
    -- invalidation. Restart with the union of tags and a new owner.
    r.tags = shared
    removeMeta(leaseField)
  end
  local active = 0
  for _, field in ipairs(redis.call('HKEYS', KEYS[4])) do if string.sub(field, 1, 2) == 'l:' then active = active + 1 end end
  if active >= r.capacity then return response({kind='wait'}) end
  local fields = scopes()
  metadataSpace(#fields + 1)
  local generations = {}
  for _, field in ipairs(fields) do
    local token = redis.call('HGET', KEYS[4], field) or r.owner
    putMeta(field, token, now + r.metadataTtlMs)
    generations[field] = token
  end
  local value = {owner=r.owner, tags=r.tags, generations=generations, deadline=now + r.fillTimeoutMs, expires=now + r.leaseMs}
  putMeta(leaseField, cjson.encode(value), value.expires)
  return response({kind='owner'})
elseif r.op == 'renew' or r.op == 'publish' or r.op == 'release' then
  local current = lease()
  if not current or current.owner ~= r.owner then return response({owned=false}) end
  if r.op == 'release' then removeMeta(leaseField); return response({owned=true}) end
  for field, token in pairs(current.generations) do
    if redis.call('HGET', KEYS[4], field) ~= token then removeMeta(leaseField); return response({owned=false}) end
  end
  if r.op == 'renew' then
    current.expires = math.min(current.deadline, now + r.leaseMs)
    putMeta(leaseField, cjson.encode(current), current.expires)
  else
    write(r.key, r.payload, current.tags)
    removeMeta(leaseField)
  end
  return response({owned=true})
end
return redis.error_reply('Unknown cache operation')
`;

export { CACHE_SCRIPT };
