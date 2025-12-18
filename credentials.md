Localhost
root
password: z8$>9k!FJ

-- SQL Query to select transactions sorted by latest updated date
SELECT * 
FROM system_pos.transactions 
ORDER BY updated_at DESC
LIMIT 10;