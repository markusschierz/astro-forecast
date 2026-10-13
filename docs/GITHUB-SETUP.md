# GitHub-Einrichtung

Repository: https://github.com/markusschierz/astro-forecast

## Einmalig, vor dem ersten Merge nach test

1. Settings → Environments → test → Deployment branches and tags → Selected branches and tags. Regel für Branch `test` hinzufügen; alte Branch-Regel `main` entfernen. Nicht das Environment löschen.
2. Settings → Environments → production → Deployment branches and tags → Selected branches and tags. Nur Branch `main` zulassen.
3. In beiden Environments Required reviewers und Wait timer deaktivieren, sofern gesetzt. Der PR-Merge nach main dient als Freigabe.
4. Environment-Variablen und bestehende Secrets beibehalten:

| Variable | test | production |
| --- | --- | --- |
| SITE_URL | https://test.astro-foto.ch | https://astro-foto.ch |
| APP_PATH | /astro-forecast | /astro-forecast |
| SFTP_PORT | 22 | 22 |
| SFTP_REMOTE_DIR | bestehendes Verzeichnis der Testwebsite | bestehendes Verzeichnis der Produktionswebsite |

SFTP_REMOTE_DIR enthält nicht den zusätzlichen Unterordner /astro-forecast. Vorhandene SFTP-Secrets einschließlich Passphrase nicht ersetzen.

5. Settings → Rules → Rulesets: vorhandenen Schutz für main beibehalten (Pull Request erforderlich; Check baseline erforderlich; Force-Push und Löschen sperren). Entsprechenden Schutz für test konfigurieren, soweit der Tarif dies unterstützt. Keine verpflichtigende Fremdfreigabe setzen, wenn nur Markus freigibt. Keine lineare Historie erzwingen, wenn Merge commits verwendet werden.
6. Settings → General → Pull Requests: Allow merge commits aktivieren. Automatically delete head branches deaktivieren, damit test nach Produktionsfreigaben erhalten bleibt.
7. Den vorbereiteten Einrichtungs-PR nach test mergen. Dadurch starten Tests und Deploy test automatisch. Eine separate Workflow-Ausführung oder Run-ID ist nicht erforderlich.
8. Actions → Deploy test: erfolgreicher Lauf für test abwarten; https://test.astro-foto.ch/astro-forecast/ prüfen.
9. Pull requests → New pull request → base main, compare test → Create pull request. Vor dem Merge den Stand nicht weiter verändern. Nach Sichtprüfung mit Create a merge commit mergen. Dieser erste Merge aktiviert zugleich die neuen Workflows auf main und deployt Version 3.10 auf Produktion.
10. Actions → Deploy production auf Erfolg prüfen; https://astro-foto.ch/astro-forecast/ kontrollieren.
11. main anschließend per PR nach test zurückführen. Dies verhindert auseinanderlaufende Historien.

## Spätere Änderungen

Arbeitsbranch → PR nach test → automatische Prüfungen und Testdeployment → Sichtprüfung → PR nach main → automatisches Produktionsdeployment. Produktion wird gesperrt, wenn für ihren Dateiinhalt kein erfolgreiches Testdeployment existiert. GitHub prüft die technische Übereinstimmung; die Sichtprüfung erfolgt durch Markus vor dem Merge. Keine Secrets oder zusätzlichen Tokens sind für die Run-Auswahl nötig; der Workflow nutzt den integrierten Token mit actions:read und contents:read.

Alte vollständig in main enthaltene Arbeitsbranches können unter Code → Branches gelöscht werden. main und test bleiben bestehen. Neue Arbeitsbranches erst nach ihrem Merge löschen. Keine Dateien, Environments oder Repositorys löschen.
