import type { Env } from "../env.d";
import { createEtoroProviders } from "../providers/etoro";
import { createSECEdgarProvider } from "../providers/news/sec-edgar";
import { createD1Client } from "../storage/d1/client";
import { cleanupExpiredApprovals } from "../storage/d1/queries/approvals";
import { insertRawEvent, rawEventExists } from "../storage/d1/queries/events";
import { getRiskState, resetDailyLoss } from "../storage/d1/queries/risk-state";

export async function handleCronEvent(cronId: string, env: Env): Promise<void> {
  switch (cronId) {
    case "*/5 13-20 * * 1-5":
      await runEventIngestion(env);
      break;

    case "0 14 * * 1-5":
      await runMarketOpenPrep(env);
      break;

    case "30 21 * * 1-5":
      await runMarketCloseCleanup(env);
      break;

    case "0 5 * * *":
      await runMidnightReset(env);
      break;

    case "0 * * * *":
      await runHourlyCacheRefresh(env);
      break;

    default:
      console.log(`Unknown cron: ${cronId}`);
  }
}

async function runEventIngestion(env: Env): Promise<void> {
  console.log("Starting event ingestion...");

  const db = createD1Client(env.DB);
  const broker = createEtoroProviders(env);

  try {
    const clock = await broker.trading.getClock();

    if (!clock.is_open) {
      console.log("Market closed, skipping event ingestion");
      return;
    }

    const riskState = await getRiskState(db);
    if (riskState.kill_switch_active) {
      console.log("Kill switch active, skipping event ingestion");
      return;
    }

    const secProvider = createSECEdgarProvider();
    const events = await secProvider.poll();

    let newEvents = 0;
    for (const event of events) {
      const exists = await rawEventExists(db, event.source, event.source_id);
      if (!exists) {
        await insertRawEvent(db, {
          source: event.source,
          source_id: event.source_id,
          raw_content: event.content,
        });
        newEvents++;
      }
    }

    console.log(`Event ingestion complete: ${newEvents} new events`);
  } catch (error) {
    console.error("Event ingestion error:", error);
  }
}

async function runMarketOpenPrep(env: Env): Promise<void> {
  console.log("Running market open prep...");

  const db = createD1Client(env.DB);

  try {
    const riskState = await getRiskState(db);
    console.log(
      `Risk state at open: kill_switch=${riskState.kill_switch_active}, daily_loss=${riskState.daily_loss_usd}`
    );

    const cleaned = await cleanupExpiredApprovals(db);
    console.log(`Cleaned up ${cleaned} expired approvals`);
  } catch (error) {
    console.error("Market open prep error:", error);
  }
}

async function runMarketCloseCleanup(env: Env): Promise<void> {
  console.log("Running market close cleanup...");

  const db = createD1Client(env.DB);
  const broker = createEtoroProviders(env);

  try {
    const positions = await broker.trading.getPositions();
    const account = await broker.trading.getAccount();

    console.log(`End of day: ${positions.length} positions, equity=${account.equity}`);

    const cleaned = await cleanupExpiredApprovals(db);
    console.log(`Cleaned up ${cleaned} expired approvals`);
  } catch (error) {
    console.error("Market close cleanup error:", error);
  }
}

async function runMidnightReset(env: Env): Promise<void> {
  console.log("Running midnight reset...");

  const db = createD1Client(env.DB);

  try {
    await resetDailyLoss(db);
    console.log("Daily loss counter reset");

    const cleaned = await cleanupExpiredApprovals(db);
    console.log(`Cleaned up ${cleaned} expired approvals`);
  } catch (error) {
    console.error("Midnight reset error:", error);
  }
}

async function runHourlyCacheRefresh(_env: Env): Promise<void> {
  console.log("Running hourly cache refresh...");
  // TODO: Implement cache refresh for KV-cached data (movers, macro, etc.)
}
