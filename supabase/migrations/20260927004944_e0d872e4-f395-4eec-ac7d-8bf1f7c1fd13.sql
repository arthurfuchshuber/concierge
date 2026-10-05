select cron.alter_job(jobid, schedule := '0 11 * * 3') from cron.job where jobname = 'refresh-city-news-daily';
select cron.alter_job(jobid, schedule := '0 11 1,10,20 * *') from cron.job where jobname = 'refresh-guide-recommendations-daily';
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'guest-followup-hourly';
