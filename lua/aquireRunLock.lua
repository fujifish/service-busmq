-- KEYS[1] - the run lock key
-- ARGV[1] - the lock expiration

local exists = redis.call('exists', KEYS[1])
-- if lock exists return nil -> you cannot aquire this lock
if exists == 1 then
    return nil
end

redis.call('setex', KEYS[1], tonumber(ARGV[1]), "rule-running")
-- lock is created (first time or after expire) -> you have aquired the lock
return "OK"