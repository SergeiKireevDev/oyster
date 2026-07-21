/** Build runner process, SSE, and RPC routes from stable-state operations. */
export function createRunnerRoutes({
  state,
  runnerFromReq,
  startRunner,
  listRunnerInfo,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  return {
    "GET /events": (req, res, url) => {
      const runner = runnerFromReq(url);
      if (!runner.proc) startRunner(runner);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`: connected ${" ".repeat(2048)}\n\n`);
      res.runnerId = runner.id;
      state.sseClients.add(res);

      let ping = null;
      req.on("close", () => {
        if (ping) clearIntervalImpl(ping);
        state.sseClients.delete(res);
      });

      if (url.searchParams.get("replay") !== "0") {
        for (const line of runner.buffer) res.write(`data: ${line}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        type: "replay_done",
        _server: true,
        runner: runner.id,
        piRunning: !!runner.proc,
        workdir: runner.dir,
        runners: listRunnerInfo(),
      })}\n\n`);
      ping = setIntervalImpl(
        () => res.write(`data: ${JSON.stringify({ type: "ping", _server: true, runners: listRunnerInfo() })}\n\n`),
        25000,
      );
    },
  };
}
