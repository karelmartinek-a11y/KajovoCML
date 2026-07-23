# Architecture

`Mail_Vectorizace` je testovaci stavova repository komponenta pro overeni noveho katalogu `repository-component-1.1`.

Tok:

1. `start(context)` otevre lokalni SQLite databazi ve stabilnim `context.storage.dataPath`.
2. V `PREPARE` overi secret grants a pripravenost uloziste bez aktivniho syncu mailboxu.
3. V `ACTIVE` muze overit IMAP `TCP_TLS` egress a drzet jedinou aktivni worker instanci pres platformni lease.
4. `invoke(input, context)` vraci ulozena metadata z lokalni databaze bez pristupu do KCML PostgreSQL.
