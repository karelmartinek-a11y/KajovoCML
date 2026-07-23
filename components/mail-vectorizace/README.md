# Mail Vectorizace

Testovaci dlouho bezici repository komponenta pro KajovoCML, ktera pripravuje synchronizaci schranky `recepce@hotelchodovas.cz` do OpenAI vectoroveho uloziste.

Komponenta deklaruje:

- `LONG_RUNNING` execution mode
- persistentni lokalni stav v `context.storage.dataPath`
- runtime secret grants `MAIL_RECEPCE_PASS` a `API_KEY_VECTOR`
- `TCP_TLS` grant pro IMAP a `HTTPS_FETCH` grant pro OpenAI API

Aktualni testovaci predpoklad je IMAP endpoint `imap.hotelchodovas.cz:993` se shodnym SNI.
