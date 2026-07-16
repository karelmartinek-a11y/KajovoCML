alter table admin_account
  drop constraint if exists admin_account_mfa_secret_ciphertext_check;

update admin_account
   set mfa_secret = null
 where mfa_secret = '';

alter table admin_account
  add constraint admin_account_mfa_secret_ciphertext_check check (
    mfa_secret is null or mfa_secret like 'enc:v2:%'
  ) not valid;
