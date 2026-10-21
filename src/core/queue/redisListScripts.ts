// Atomic Redis protocol scripts. Keep key/ARGV order and wire formats compatible.
const SCRIPT_HEADER = `
local function checkType(key, expected)
  local actual = redis.call('TYPE', key).ok
  if actual ~= 'none' and actual ~= expected then
    return redis.error_reply('Unexpected queue key type: ' .. key)
  end
end
local function nowMs()
  local time = redis.call('TIME')
  return tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
`;

const RESERVE_JOB = `${SCRIPT_HEADER}
local err = checkType(KEYS[1], 'list') or checkType(KEYS[2], 'list') or checkType(KEYS[3], 'hash')
if err then return err end
local payload = redis.call('LINDEX', KEYS[1], -1)
if not payload then return nil end
local record = cjson.encode({strataReservation=1, id=ARGV[1], owner=ARGV[2], payload=payload})
local lease = cjson.encode({owner=ARGV[2], expiresAt=nowMs()+tonumber(ARGV[3])})
redis.call('LPUSH', KEYS[2], record)
redis.call('HSET', KEYS[3], ARGV[1], lease)
redis.call('RPOP', KEYS[1])
return record
`;

const RENEW_OR_ACK = `${SCRIPT_HEADER}
local err = checkType(KEYS[1], 'list') or checkType(KEYS[2], 'hash') or checkType(KEYS[3], 'list')
if err then return err end
local raw = redis.call('HGET', KEYS[2], ARGV[1])
if not raw then return 0 end
local ok, lease = pcall(cjson.decode, raw)
local now = nowMs()
if not ok or type(lease) ~= 'table' or lease.owner ~= ARGV[2] or not tonumber(lease.expiresAt) or tonumber(lease.expiresAt) <= now then
  return 0
end
if ARGV[4] == 'renew' then
  redis.call('HSET', KEYS[2], ARGV[1], cjson.encode({owner=ARGV[2], expiresAt=now+tonumber(ARGV[5])}))
  return 1
end
if ARGV[4] == 'quarantine' then redis.call('LPUSH', KEYS[3], ARGV[6]) end
local removed = redis.call('LREM', KEYS[1], 1, ARGV[3])
redis.call('HDEL', KEYS[2], ARGV[1])
return removed
`;

const RECLAIM_JOBS = `${SCRIPT_HEADER}
local err = checkType(KEYS[1], 'list') or checkType(KEYS[2], 'list') or checkType(KEYS[3], 'hash')
if err then return err end
local now = nowMs()
local reclaimed = 0
for _, record in ipairs(redis.call('LRANGE', KEYS[2], 0, -1)) do
  local payload, field = record, record
  local modern = false
  local ok, reservation = pcall(cjson.decode, record)
  if ok and type(reservation) == 'table' and reservation.strataReservation == 1 then
    payload, field, modern = reservation.payload, reservation.id, true
  end
  local raw = redis.call('HGET', KEYS[3], field)
  local expired = true
  if raw then
    if modern then
      local leaseOk, lease = pcall(cjson.decode, raw)
      expired = not leaseOk or type(lease) ~= 'table' or not tonumber(lease.expiresAt) or tonumber(lease.expiresAt) <= now
    else
      local reservedAt = tonumber(raw)
      expired = not reservedAt or now - reservedAt >= tonumber(ARGV[1])
    end
  end
  if expired then
    redis.call('LPUSH', KEYS[1], payload)
    redis.call('LREM', KEYS[2], 1, record)
    redis.call('HDEL', KEYS[3], field)
    reclaimed = reclaimed + 1
  end
end
return reclaimed
`;

const POLL_LIST_PRIORITIES = `${SCRIPT_HEADER}
local owner = ARGV[1]
local visibility = ARGV[2]
local reservationId = ARGV[3]
local reclaim = ARGV[4] == '1'
local function reclaimQueue(listKey, processingKey, leaseKey)
  local err = checkType(listKey, 'list') or checkType(processingKey, 'list') or checkType(leaseKey, 'hash')
  if err then return err end
  local now = nowMs()
  for _, record in ipairs(redis.call('LRANGE', processingKey, 0, -1)) do
    local payload, field = record, record
    local modern = false
    local ok, reservation = pcall(cjson.decode, record)
    if ok and type(reservation) == 'table' and reservation.strataReservation == 1 then
      payload, field, modern = reservation.payload, reservation.id, true
    end
    local raw = redis.call('HGET', leaseKey, field)
    local expired = true
    if raw then
      if modern then
        local leaseOk, lease = pcall(cjson.decode, raw)
        expired = not leaseOk or type(lease) ~= 'table' or not tonumber(lease.expiresAt) or tonumber(lease.expiresAt) <= now
      else
        local reservedAt = tonumber(raw)
        expired = not reservedAt or now - reservedAt >= tonumber(visibility)
      end
    end
    if expired then
      redis.call('LPUSH', listKey, payload)
      redis.call('LREM', processingKey, 1, record)
      redis.call('HDEL', leaseKey, field)
    end
  end
end
local function reserveQueue(listKey, processingKey, leaseKey)
  local err = checkType(listKey, 'list') or checkType(processingKey, 'list') or checkType(leaseKey, 'hash')
  if err then return err end
  local payload = redis.call('LINDEX', listKey, -1)
  if not payload then return nil end
  local record = cjson.encode({strataReservation=1, id=reservationId, owner=owner, payload=payload})
  local lease = cjson.encode({owner=owner, expiresAt=nowMs()+tonumber(visibility)})
  redis.call('LPUSH', processingKey, record)
  redis.call('HSET', leaseKey, reservationId, lease)
  redis.call('RPOP', listKey)
  return record
end
local count = #KEYS / 3
if reclaim then
  for i = 1, count do
    local err = reclaimQueue(KEYS[(i - 1) * 3 + 1], KEYS[(i - 1) * 3 + 2], KEYS[(i - 1) * 3 + 3])
    if err then return err end
  end
end
for i = 1, count do
  local record = reserveQueue(KEYS[(i - 1) * 3 + 1], KEYS[(i - 1) * 3 + 2], KEYS[(i - 1) * 3 + 3])
  if type(record) == 'string' then return {'1', tostring(i), record} end
  if record then return record end
end
return {'0'}
`;

export { POLL_LIST_PRIORITIES, RECLAIM_JOBS, RENEW_OR_ACK, RESERVE_JOB };
