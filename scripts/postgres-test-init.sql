-- Test databases for the CI run: one hot shard + one archive shard for region
-- `eg` (REGIONS=eg in docker-compose.test.yml). Created on the postgres
-- container's first boot.
CREATE DATABASE order_test_eg;
CREATE DATABASE order_test_archive_eg;
