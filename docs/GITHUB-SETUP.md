# GitHub-Einrichtung

Repository: https://github.com/markusschierz/astro-forecast

## Dauerhafte Branches und Einstellungen

main und test dauerhaft behalten. Falls test bei einer neuen Einrichtung noch fehlt, den Branch aus main erstellen. Für das bestehende Repository ist keine erneute Branch-Einrichtung erforderlich.

Die folgenden Einstellungen bei einer neuen Einrichtung konfigurieren oder im bestehenden Repository prüfen:

1. Settings → Environments → test → Deployment branches and tags → Selected branches and tags. Nur Branch `test` zulassen. Nicht das Environment löschen.
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

## Aktueller Entwicklungs- und Freigabeablauf

1. Vor Auswahl oder Erstellung eines Entwicklungsbranchs die aktuelle Produktionsversion in index.html auf main ermitteln und mit dem Cache-Namen in sw.js abgleichen. Keine Entwicklungsversion aus einer Dokumentation übernehmen. Den nächsten Release auf develop/<version> vom aktuellen test-Branch entwickeln. Änderungen nur an Dokumentation, Tests oder Infrastruktur erhöhen die App-Version nicht.
2. Zusammengehörige Änderungen per PR nach test übernehmen; nicht direkt auf test oder main pushen. Dadurch starten baseline und Deploy test automatisch. Eine separate Workflow-Ausführung oder Run-ID ist nicht erforderlich.
3. Actions → Deploy test: erfolgreichen Lauf abwarten. Markus prüft https://test.astro-foto.ch/astro-forecast/ visuell. Während Sichtprüfung und Promotion keine weiteren Änderungen nach test übernehmen.
4. Pull requests → New pull request → base main, compare test → Create pull request. Markus' Merge mit Create a merge commit ist die Produktionsfreigabe. Agents dürfen diesen PR nur mit ausdrücklicher Autorisierung mergen.
5. Deploy production wählt automatisch einen erfolgreichen Deploy-test-Lauf mit exakt gleichem vollständigem Git-Dateibaum und deployt dessen Commit. Unterschiedliche Merge-Commit-SHAs sind erlaubt; abweichende Inhalte sind gesperrt. Keine Secrets oder zusätzlichen Tokens sind für die Run-Auswahl nötig; der Workflow nutzt den integrierten Token mit actions:read und contents:read.
6. Actions → Deploy production auf Erfolg prüfen und https://astro-foto.ch/astro-forecast/ kontrollieren.
7. main anschließend per PR nach test zurückführen. Dies verhindert auseinanderlaufende Historien.

Alte vollständig in main enthaltene Arbeitsbranches können unter Code → Branches gelöscht werden. main und test bleiben bestehen. Neue Arbeitsbranches erst nach ihrem Merge löschen. Keine Dateien, Environments oder Repositorys löschen.
