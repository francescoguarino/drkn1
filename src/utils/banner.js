const chalk = require("chalk");
const figlet = require("figlet");
const clear = require("clear");

function showBanner() {
  clear();
  console.log(
    chalk.red(
      figlet.textSync("DRAKON NODE", {
        font: "ANSI Shadow",
        horizontalLayout: "full",
      })
    )
  );

  console.log(
    chalk.yellow(
      "═══════════════════════════════════════════════════════════════════════════════"
    )
  );
  console.log(
    chalk.blue("  🔗 Blockchain Network Node  ") +
      chalk.gray("|") +
      chalk.green("  Version: 1.0.0  ") +
      chalk.gray("|") +
      chalk.cyan("  Status: Active")
  );
  console.log(
    chalk.yellow(
      "═══════════════════════════════════════════════════════════════════════════════\n"
    )
  );
}

function showNodeInfo(info) {
  const Table = require("cli-table3");

  const table = new Table({
    head: [chalk.cyan("Metric"), chalk.cyan("Value")],
    style: {
      head: [],
      border: [],
    },
  });

  table.push(
    { "Network ID": chalk.green(info.network.myId) },
    { "Active Peers": chalk.yellow(info.network.peersCount) },
    {
      "Messages Processed": chalk.magenta(
        info.network.messagesSent + info.network.messagesReceived
      ),
    },
    { Uptime: chalk.blue(Math.floor(info.uptime / 60) + " minutes") }
  );

  console.log(table.toString());
  console.log("");
}

module.exports = {
  showBanner,
  showNodeInfo,
};
