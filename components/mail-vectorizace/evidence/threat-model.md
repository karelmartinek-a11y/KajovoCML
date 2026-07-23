# Threat model

- Tajemstvi `MAIL_RECEPCE_PASS` a `API_KEY_VECTOR` se resi pouze za behu pres KCML secret broker.
- Komponenta nema primy pristup do KCML PostgreSQL ani k datarum jinych komponent.
- IMAP spojeni je povoleno pouze pres presny `TCP_TLS` grant na `imap.hotelchodovas.cz:993` se shodnym SNI.
- Persisted data zustavaji v komponentovem datovem rootu a ne v release nebo socket adresari.
