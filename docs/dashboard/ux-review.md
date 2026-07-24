# Dashboard KájovoCML – UI/UX review

## Realizovaný průchod

- Dashboard je první OWNER položkou navigace a výchozí OWNER landing page.
- Předregistrační a registrované uzly jsou rozlišeny textem, ikonou a stavem, nikoli jen barvou.
- Porty zobrazují kompatibilitu, vlákna účinnou autorizaci.
- Edge lze ovládat myší, klávesami Enter/Space a kontextovou klávesou nebo Shift+F10.
- Secret knihovna je opakovaně použitelná; drop vytvoří grant a zdrojová karta zůstává.
- Canvas má zoom, fit-to-view, drag layout, minimapu a seznamovou alternativu.
- Kontextový panel zpřístupňuje suspendaci, audit, tokenovou identitu, Secret granty a destruktivní deregistraci.
- Mobilní breakpoint skládá pracovní plochu do vertikálního layoutu; `prefers-reduced-motion` vypíná pohyb bez ztráty textového stavu.

## Záměrně nedeklarované důkazy

Bez běžícího produkčního buildu nebyly vytvořeny ani označeny jako hotové produkční screenshoty, touch-device záznamy, vizuální diff ani post-deploy design review. Evidence manifest je proto veden jako `PENDING_DEPLOYMENT`, nikoli jako falešný PASS.
