import { spawnSync } from "node:child_process";

type Confirmation = { error?: Error; status: number | null };
type RequestConfirmation = () => Confirmation;

function requestSystemConfirmation(): Confirmation {
  return spawnSync(
    "/usr/bin/osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      'const app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayDialog("Agent Adaptor wants to read your clipboard and save it as the Cursor API key.", {withTitle: "Agent Adaptor", buttons: ["Cancel", "Allow"], defaultButton: "Cancel", cancelButton: "Cancel", withIcon: "caution"});',
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
}

export function confirmClipboardAccess(request: RequestConfirmation = requestSystemConfirmation) {
  const confirmation = request();
  if (confirmation.error) {
    throw new Error(`Could not request clipboard confirmation: ${confirmation.error.message}`);
  }
  if (confirmation.status !== 0) throw new Error("Clipboard configuration cancelled.");
}
