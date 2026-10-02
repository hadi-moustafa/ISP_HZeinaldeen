-- Removes the Management feature added in 0033 (client dropped it in favour
-- of a different design). 0033 stays in the repo because it is already
-- recorded as applied on the live project; this undoes it. The table had no
-- rows when dropped.
DROP TABLE IF EXISTS management_items;
