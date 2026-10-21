// Atomic Redis protocol scripts. Keep key/ARGV order and wire formats compatible.
const LEASE_SCRIPT = `
for _, key in ipairs(KEYS) do
  local kind = redis.call('TYPE', key).ok
  if kind ~= 'none' and kind ~= 'string' then return redis.error_reply('Unexpected scheduler key type') end
end
local action = ARGV[1]
local token = ARGV[2]
local ttl = tonumber(ARGV[3])
if action == 'acquire' then
  if redis.call('EXISTS', KEYS[3]) == 1 or redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
  redis.call('SET', KEYS[1], token, 'PX', ttl)
  redis.call('SET', KEYS[2], token, 'PX', ttl)
  return 1
end
if redis.call('GET', KEYS[1]) ~= token or redis.call('GET', KEYS[2]) ~= token then return 0 end
if action == 'renew' then
  redis.call('PEXPIRE', KEYS[1], ttl)
  redis.call('PEXPIRE', KEYS[2], ttl)
elseif action == 'complete' then
  redis.call('SET', KEYS[3], 'completed', 'PX', ttl)
  redis.call('DEL', KEYS[1], KEYS[2])
elseif action == 'release' then
  redis.call('DEL', KEYS[1], KEYS[2])
else return redis.error_reply('Unexpected scheduler action') end
return 1
`;

export { LEASE_SCRIPT };
