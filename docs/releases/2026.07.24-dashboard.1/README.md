# KájovoCML 2026.07.24-dashboard.1

Aditivní release aktivního Dashboardu. Zachovává manifest a PULSE kontrakt `2026.07.22-compliance.1`, zavádí Onboarding Catalog `1.2`, persistentní vizuální uzly, PULSE topologii, oddělenou kompatibilitu a autorizaci, reverzibilní suspendaci, Dashboard Secret granty, externí boundary uzly a persistovaný STARTED/COMPLETED/BLOCKED runtime stream.

Databázové změny jsou dopředné migrace `004`–`006`; historická migrace `001` ani katalog `1.1` nejsou měněny. Produkční dokončení vyžaduje zelené CI, upgrade test na disposable PostgreSQL, deploy a důkazní manifest svázaný s commit SHA/build ID.
