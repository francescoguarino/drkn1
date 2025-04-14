import chalk from 'chalk';
import Table from 'cli-table3';

export function displayBanner(config) {
  const asciiArt = `
  ██████╗  ██████╗  █████╗ ██╗  ██╗ ██████╗ ███╗   ██╗    ███╗   ██╗ ██████╗ ██████╗ ███████╗
  ██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝██╔═══██╗████╗  ██║    ████╗  ██║██╔═══██╗██╔══██╗██╔════╝
  ██║  ██║██████╔╝███████║█████╔╝ ██║   ██║██╔██╗ ██║    ██╔██╗ ██║██║   ██║██║  ██║█████╗  
  ██║  ██║██╔══██╗██╔══██║██╔═██╗ ██║   ██║██║╚██╗██║    ██║╚██╗██║██║   ██║██║  ██║██╔══╝  
  ██████╔╝██║  ██║██║  ██║██║  ██╗╚██████╔╝██║ ╚████║    ██║ ╚████║╚██████╔╝██████╔╝███████╗
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝    ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝
                                                                                         
`;

  const banner = `
${chalk.cyan(asciiArt)}
${chalk.cyan('╔════════════════════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')} ${chalk.white('Informazioni Nodo')}${' '.repeat(
    71 - 'Informazioni Nodo'.length
  )} ${chalk.cyan('║')}
${chalk.cyan('╠════════════════════════════════════════════════════════════════════════════╣')}
${chalk.cyan('║')} ${chalk.white('Versione:')} ${chalk.yellow(config.version || 'N/A')}${' '.repeat(
    74 - ('Versione: '.length + (config.version?.length || 3))
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Network:')} ${chalk.yellow(
    config.network?.type || 'N/A'
  )}${' '.repeat(74 - ('Network: '.length + (config.network?.type?.length || 3)))} ${chalk.cyan(
    '║'
  )}
${chalk.cyan('║')} ${chalk.white('Canale:')} ${chalk.yellow(config.channel || 'N/A')}${' '.repeat(
    74 - ('Canale: '.length + (config.channel?.length || 3))
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Porta P2P:')} ${chalk.yellow(
    config.p2p?.port || 'N/A'
  )}${' '.repeat(
    74 - ('Porta P2P: '.length + String(config.p2p?.port || 'N/A').length)
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Porta API:')} ${chalk.yellow(
    config.api?.port || 'N/A'
  )}${' '.repeat(
    74 - ('Porta API: '.length + String(config.api?.port || 'N/A').length)
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Directory Dati:')} ${chalk.yellow(
    config.storage?.path || 'N/A'
  )}${' '.repeat(
    74 - ('Directory Dati: '.length + (config.storage?.path?.length || 3))
  )} ${chalk.cyan('║')}
${chalk.cyan('╠════════════════════════════════════════════════════════════════════════════╣')}
${chalk.cyan('║')} ${chalk.white('ID Nodo:')} ${chalk.yellow(config.node?.id || 'N/A')}${' '.repeat(
    74 - ('ID Nodo: '.length + (config.node?.id?.length || 3))
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Mining:')} ${chalk.yellow(
    config.mining?.enabled ? 'Abilitato' : 'Disabilitato'
  )}${' '.repeat(
    74 - ('Mining: '.length + (config.mining?.enabled ? 'Abilitato' : 'Disabilitato').length)
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Difficoltà Mining:')} ${chalk.yellow(
    config.mining?.difficulty || 'N/A'
  )}${' '.repeat(
    74 - ('Difficoltà Mining: '.length + String(config.mining?.difficulty || 'N/A').length)
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Ambiente:')} ${chalk.yellow(
    config.environment || process.env.NODE_ENV || 'development'
  )}${' '.repeat(
    74 -
      ('Ambiente: '.length + (config.environment || process.env.NODE_ENV || 'development').length)
  )} ${chalk.cyan('║')}
${chalk.cyan('║')} ${chalk.white('Bootstrap Nodes:')} ${chalk.yellow(
    Array.isArray(config.p2p?.bootstrapNodes) ? config.p2p.bootstrapNodes.length : 'N/A'
  )}${' '.repeat(
    74 -
      ('Bootstrap Nodes: '.length +
        String(Array.isArray(config.p2p?.bootstrapNodes) ? config.p2p.bootstrapNodes.length : 'N/A')
          .length)
  )} ${chalk.cyan('║')}
${chalk.cyan('╚════════════════════════════════════════════════════════════════════════════╝')}
`;

  console.log(banner);
}

export function showNodeInfo(info) {
  const table = new Table({
    head: [chalk.cyan('Metrica'), chalk.cyan('Valore')],
    style: {
      head: [],
      border: []
    }
  });

  table.push(
    { 'ID Rete': chalk.green(info.network?.myId || 'N/A') },
    { 'Peer Attivi': chalk.yellow(info.network?.peersCount || 0) },
    {
      'Messaggi Processati': chalk.magenta(
        (info.network?.messagesSent || 0) + (info.network?.messagesReceived || 0)
      )
    },
    { 'Altezza Blockchain': chalk.blue(info.blockchain?.height || 0) },
    { Uptime: chalk.blue(Math.floor((info.uptime || 0) / 60) + ' minuti') },
    { 'Transazioni in Pool': chalk.yellow(info.mempool?.size || 0) }
  );

  console.log(table.toString());
  console.log('');
}

export function displayBootstrapBanner(config) {
  const bannerText = `
  ██████╗  ██████╗   █████╗  ██╗  ██╗  ██████╗  ███╗   ██╗
  ██╔══██╗ ██╔══██╗ ██╔══██╗ ██║ ██╔╝ ██╔═══██╗ ████╗  ██║
  ██║  ██║ ██████╔╝ ███████║ █████╔╝  ██║   ██║ ██╔██╗ ██║
  ██║  ██║ ██╔══██╗ ██╔══██║ ██╔═██╗  ██║   ██║ ██║╚██╗██║
  ██████╔╝ ██║  ██║ ██║  ██║ ██║  ██╗ ╚██████╔╝ ██║ ╚████║
  ╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝  ╚═════╝  ╚═╝  ╚═══╝
  
  ███████╗ ███╗   ██╗ ████████╗ ███████╗ ██████╗   
  ██╔════╝ ████╗  ██║ ╚══██╔══╝ ██╔════╝ ██╔══██╗  
  █████╗   ██╔██╗ ██║    ██║    █████╗   ██████╔╝  
  ██╔══╝   ██║╚██╗██║    ██║    ██╔══╝   ██╔══██╗  
  ███████╗ ██║ ╚████║    ██║    ███████╗ ██║  ██║  
  ╚══════╝ ╚═╝  ╚═══╝    ╚═╝    ╚══════╝ ╚═╝  ╚═╝  

  ███╗   ██╗  ██████╗  ██████╗  ███████╗
  ████╗  ██║ ██╔═══██╗ ██╔══██╗ ██╔════╝
  ██╔██╗ ██║ ██║   ██║ ██║  ██║ █████╗  
  ██║╚██╗██║ ██║   ██║ ██║  ██║ ██╔══╝  
  ██║ ╚████║ ╚██████╔╝ ██████╔╝ ███████╗
  ╚═╝  ╚═══╝  ╚═════╝  ╚═════╝  ╚══════╝
  `;

  console.log(bannerText);

  const configSummary = `
╔════════════════════════════════════════════════════════════════════════════╗
║ Informazioni Nodo Bootstrap                                              ║
╠════════════════════════════════════════════════════════════════════════════╣
║ Versione: ${config.version || '1.0.0'}${' '.repeat(Math.max(0, 60 - (config.version || '1.0.0').length))}║
║ Network: ${config.network?.type || 'testnet'}${' '.repeat(Math.max(0, 62 - (config.network?.type || 'testnet').length))}║
║ Canale: ${config.channel || 'N/A'}${' '.repeat(Math.max(0, 63 - (config.channel || 'N/A').length))}║
║ Porta P2P: ${config.p2p?.port || 'N/A'}${' '.repeat(Math.max(0, 61 - String(config.p2p?.port || 'N/A').length))}║
║ Porta API: ${config.api?.port || 'N/A'}${' '.repeat(Math.max(0, 61 - String(config.api?.port || 'N/A').length))}║
║ Directory Dati: ${config.storage?.path || 'N/A'}${' '.repeat(Math.max(0, 56 - String(config.storage?.path || 'N/A').length))}║
╠════════════════════════════════════════════════════════════════════════════╣
║ ID Nodo: ${config.node?.id || 'N/A'}${' '.repeat(Math.max(0, 62 - String(config.node?.id || 'N/A').length))}║
║ Ambiente: ${config.environment || 'development'}${' '.repeat(Math.max(0, 61 - (config.environment || 'development').length))}║
╚════════════════════════════════════════════════════════════════════════════╝
`;

  console.log(configSummary);

  return configSummary;
}
