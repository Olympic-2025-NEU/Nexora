# P00-D03 PostgreSQL transaction spike (`pg` — historical)

> **Superseded for adapter choice:** SoT is Prisma — see [`../../spike-d03.md`](../../spike-d03.md) and ADR `0003-database-prisma.md`. Keep this folder only as TX semantics evidence.

This isolated test proves `pg` repositories share one `PoolClient`: a document, stock balance, stock movement, audit and outbox row all commit or all roll back. It also checks migration checksum/rerun and concurrent issues that exceed stock. It uses a **disposable** DB named `nexora_p00` and refuses any other database name. No application migration or production table is changed.

Run with Docker Desktop and Node 24 on PowerShell:

```powershell
docker run --rm -d --name nexora-p00-d03-pg -e POSTGRES_DB=nexora_p00 -e POSTGRES_PASSWORD=p00_demo_only -p 127.0.0.1:55437:5432 postgres:17@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac
do { Start-Sleep -Seconds 1; docker exec nexora-p00-d03-pg pg_isready -U postgres -d nexora_p00 } until ($LASTEXITCODE -eq 0)
npm ci --prefix documents/phase-plan/evidence/spikes/d03
$env:P00_DATABASE_URL = 'postgres://postgres:p00_demo_only@127.0.0.1:55437/nexora_p00'
npm test --prefix documents/phase-plan/evidence/spikes/d03
Remove-Item Env:P00_DATABASE_URL
docker stop nexora-p00-d03-pg
```

Expected JSON: `result=PASS`, migration applied (or already unchanged on a rerun), rerun unchanged and checksum mismatch rejected, rollback `balance=20.000/documents=0/movements=0/audits=0/outbox=0`, final after a committed issue 12 and two concurrent issues 5 is `balance=3.000/documents=2/movements=2/audits=2/outbox=2`. The password above is synthetic for this isolated ephemeral container only. See [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL transactions](https://www.postgresql.org/docs/17/tutorial-transactions.html), [PostgreSQL numeric](https://www.postgresql.org/docs/17/datatype-numeric.html).
