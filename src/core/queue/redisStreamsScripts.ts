// Atomic Redis protocol scripts. Keep key/ARGV order and wire formats compatible.
const ENQUEUE_CONTROLLED = `
local kind = redis.call('TYPE', KEYS[1]).ok
if kind ~= 'none' and kind ~= 'stream' then return redis.error_reply('Invalid stream admission key type') end
if redis.call('EXISTS', KEYS[2]) ~= 0 then return redis.error_reply('Streams control identity already exists') end
redis.call('XADD', KEYS[1], '*', 'payload', ARGV[1])
redis.call('HSET', KEYS[2], 'state', 'active')
return 1
`;

const CANCEL_STREAM = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 0 end
local kind = redis.call('TYPE', KEYS[2]).ok
if kind ~= 'none' and kind ~= 'zset' then return redis.error_reply('Invalid stream retry key type') end
local payload = redis.call('HGET', KEYS[1], 'retryPayload')
if payload and redis.call('ZSCORE', KEYS[2], payload) then redis.call('ZADD', KEYS[2], 0, payload) end
redis.call('HSET', KEYS[1], 'state', 'cancelled')
return 1
`;

const SCHEDULE_RETRY = `
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 or pending[1][2] ~= ARGV[3] or tonumber(pending[1][3]) >= tonumber(ARGV[4]) then return 0 end
local kind = redis.call('TYPE', KEYS[2]).ok
if kind ~= 'none' and kind ~= 'zset' then return redis.error_reply('Invalid stream retry key type') end
if ARGV[8] == '1' then
  local state = redis.call('HGET', KEYS[3], 'state')
  if state == 'cancelled' then return redis.error_reply('Streams job cancelled') end
  if state ~= 'active' then return redis.error_reply('Missing or invalid Streams control state') end
end
local now = redis.call('TIME')
local due = tonumber(now[1])*1000 + math.floor(tonumber(now[2])/1000) + tonumber(ARGV[5])
if ARGV[7] ~= '' then due = math.min(due, tonumber(ARGV[7])) end
redis.call('ZADD', KEYS[2], due, ARGV[6])
if ARGV[8] == '1' then redis.call('HSET', KEYS[3], 'retryPayload', ARGV[6]) end
redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
redis.call('XDEL', KEYS[1], ARGV[2])
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[3]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[3]) end
return 1
`;

const PROMOTE_RETRIES = `
local kinds = {'stream','zset'}
for i=1,2 do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= kinds[i] then return redis.error_reply('Invalid stream retry promotion key type') end
end
local now = redis.call('TIME')
local due = tonumber(now[1])*1000 + math.floor(tonumber(now[2])/1000)
local entries = redis.call('ZRANGE', KEYS[2], '-inf', due, 'BYSCORE', 'LIMIT', 0, 100)
for _, payload in ipairs(entries) do
  redis.call('XADD', KEYS[1], '*', 'payload', payload)
  redis.call('ZREM', KEYS[2], payload)
end
return #entries
`;

const POLL_STREAM_PRIORITIES = `
local group = ARGV[1]
local owner = ARGV[2]
local visibility = ARGV[3]
local function payloadOf(fields)
  for index = 1, #fields, 2 do
    if fields[index] == 'payload' and type(fields[index + 1]) == 'string' then return fields[index + 1] end
  end
  return ''
end
local cursors = {}
for i = 1, #KEYS / 2 do cursors[i] = ARGV[3 + i] end
for i = 1, #KEYS / 2 do
  local stream = KEYS[(i - 1) * 2 + 1]
  local retries = KEYS[(i - 1) * 2 + 2]
  local cursor = ARGV[3 + i]
  local streamKind = redis.call('TYPE', stream).ok
  local retryKind = redis.call('TYPE', retries).ok
  if streamKind ~= 'none' and streamKind ~= 'stream' then return redis.error_reply('Invalid stream retry promotion key type') end
  if retryKind ~= 'none' and retryKind ~= 'zset' then return redis.error_reply('Invalid stream retry promotion key type') end
  if streamKind == 'stream' then
    local now = redis.call('TIME')
    local due = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
    local ready = redis.call('ZRANGE', retries, '-inf', due, 'BYSCORE', 'LIMIT', 0, 100)
    for _, payload in ipairs(ready) do
      redis.call('XADD', stream, '*', 'payload', payload)
      redis.call('ZREM', retries, payload)
    end
    local window = redis.call('XPENDING', stream, group, cursor, '+', 10)
    local claimed = redis.call('XAUTOCLAIM', stream, group, owner, visibility, cursor, 'COUNT', 1)
    for _, entry in ipairs(window) do
      if entry[2] ~= owner and #redis.call('XPENDING', stream, group, '-', '+', 1, entry[2]) == 0 then
        redis.call('XGROUP', 'DELCONSUMER', stream, group, entry[2])
      end
    end
    if #redis.call('XPENDING', stream, group, '-', '+', 1, owner) == 0 then
      redis.call('XGROUP', 'DELCONSUMER', stream, group, owner)
    end
    cursors[i] = claimed[1]
    if #claimed[2] > 0 then
      return {'1', tostring(i), claimed[2][1][1], payloadOf(claimed[2][1][2]), unpack(cursors)}
    end
    local fresh = redis.call('XREADGROUP', 'GROUP', group, owner, 'COUNT', 1, 'STREAMS', stream, '>')
    if not fresh and #redis.call('XPENDING', stream, group, '-', '+', 1, owner) == 0 then
      redis.call('XGROUP', 'DELCONSUMER', stream, group, owner)
    end
    if fresh and #fresh > 0 and #fresh[1][2] > 0 then
      return {'1', tostring(i), fresh[1][2][1][1], payloadOf(fresh[1][2][1][2]), unpack(cursors)}
    end
  end
end
return {'0', unpack(cursors)}
`;

const ASSERT_DRAINED = `
if redis.call('LLEN', KEYS[1]) > 0 or redis.call('LLEN', KEYS[2]) > 0 or redis.call('HLEN', KEYS[3]) > 0 then
  return redis.error_reply('Legacy queue state requires maintenance conversion before Streams activation')
end
return 1
`;

const UPDATE_STREAM = `
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 or pending[1][2] ~= ARGV[3] or tonumber(pending[1][3]) >= tonumber(ARGV[4]) then return 0 end
if ARGV[7] == '1' then
  local kind = redis.call('TYPE', KEYS[3]).ok
  if kind ~= 'none' and kind ~= 'hash' then return redis.error_reply('Invalid stream control key type') end
end
if ARGV[5] == 'renew' then
  local claimed = redis.call('XCLAIM', KEYS[1], ARGV[1], ARGV[3], 0, ARGV[2], 'JUSTID')
  return #claimed
end
if ARGV[5] == 'quarantine' then
  local kind = redis.call('TYPE', KEYS[2]).ok
  if kind ~= 'none' and kind ~= 'stream' then return redis.error_reply('Invalid stream quarantine key type') end
  redis.call('XADD', KEYS[2], '*', 'sourceId', ARGV[2], 'payload', ARGV[6])
end
local acknowledged = redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
if acknowledged == 1 then
  redis.call('XDEL', KEYS[1], ARGV[2])
  if ARGV[7] == '1' then redis.call('DEL', KEYS[3]) end
end
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[3]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[3]) end
return acknowledged
`;

const CLAIM_STREAM = `
local window = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[4], '+', 10)
local claimed = redis.call('XAUTOCLAIM', KEYS[1], ARGV[1], ARGV[2], ARGV[3], ARGV[4], 'COUNT', 1)
for _, entry in ipairs(window) do
  if entry[2] ~= ARGV[2] and #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, entry[2]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], entry[2]) end
end
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[2]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2]) end
return claimed
`;

const READ_STREAM = `
local entries = redis.call('XREADGROUP', 'GROUP', ARGV[1], ARGV[2], 'COUNT', 1, 'STREAMS', KEYS[1], '>')
if not entries and #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[2]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2]) end
return entries
`;

const CONVERT_LIST = `
local kinds = {'list','list','hash','stream'}
for i=1,4 do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= kinds[i] then return redis.error_reply('Invalid queue conversion key type') end
end
if redis.call('LLEN', KEYS[2]) > 0 or redis.call('HLEN', KEYS[3]) > 0 then return redis.error_reply('Drain or recover processing reservations before queue conversion') end
local converted = 0
for i=1,tonumber(ARGV[1]) do
  local payload = redis.call('LINDEX', KEYS[1], -1)
  if not payload then break end
  redis.call('XADD', KEYS[4], '*', 'payload', payload)
  redis.call('RPOP', KEYS[1])
  converted = converted + 1
end
return converted
`;

export {
  ASSERT_DRAINED,
  CANCEL_STREAM,
  CLAIM_STREAM,
  CONVERT_LIST,
  ENQUEUE_CONTROLLED,
  POLL_STREAM_PRIORITIES,
  PROMOTE_RETRIES,
  READ_STREAM,
  SCHEDULE_RETRY,
  UPDATE_STREAM,
};
