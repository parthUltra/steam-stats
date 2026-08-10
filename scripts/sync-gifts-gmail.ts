import { syncGiftsFromGmail } from "../src/lib/gifts/sync-gmail-playwright";

async function main() {
  console.log("Starting Gmail gift sync (system browser)…");
  const result = await syncGiftsFromGmail();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error(result.error || "Gmail sync failed");
    process.exitCode = 1;
  } else {
    console.log(
      `Done · parsed ${result.parsed} · added ${result.added} · total ${result.total}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
