/**
 * Known-funder registry seed rows — Xander V2 spec section 12.3.
 *
 * EVERY ADDRESS HERE WAS VERIFIED, NONE WERE TYPED FROM MEMORY. The two groups
 * below were gathered and cross-checked on 2026-09-12 and this file was
 * generated from those sources rather than transcribed, because a single
 * mistyped nibble in an exclusion list is a silent security hole: it either
 * excuses an attacker's funder or fails to excuse a real exchange.
 *
 * BRIDGE rows come from first-party documentation — the official Base contract
 * page and the Optimism superchain-registry. Those are authoritative
 * publications by the teams that deployed the contracts, so they carry HIGH
 * confidence.
 *
 * EXCHANGE rows are the intersection of two INDEPENDENT public label datasets;
 * only addresses that appear in both, with agreeing exchange names, survived.
 * (Two rename aliases were reconciled by hand: OKEx -> OKX, MXC -> MEXC.) They
 * carry MEDIUM confidence, not HIGH: nobody at Binance publishes a signed list
 * of its hot wallets, so these labels are third-party observation, however
 * well corroborated.
 *
 * FAUCET is deliberately EMPTY. This project runs against testnets, where a
 * public faucet is the single most common shared funder and therefore the most
 * valuable row this table could hold — but no faucet operator publishes its
 * dispenser EOA, and a search of testnet explorers returns faucet *tokens*, not
 * the funding addresses. Inventing one would be the exact category of fake this
 * codebase refuses. The category is live in the enum and a row can be inserted
 * the moment a real dispenser is observed in our own evidence.
 */

export type KnownFunderCategory =
  | 'EXCHANGE'
  | 'BRIDGE'
  | 'FAUCET'
  | 'PROTOCOL_TREASURY'
  | 'KNOWN_DISTRIBUTOR'
  | 'OTHER'

export interface KnownFunderSeedRow {
  /** Always lowercase — every lookup lowercases before comparing. */
  address: string
  /** Network slug, matching EvidenceEvent.chain. */
  chain: string
  label: string
  category: KnownFunderCategory
  source: string
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
}

/** L1 bridge contracts. First-party documentation, so HIGH confidence. */
const BRIDGES: KnownFunderSeedRow[] = [
  {
    address: '0xfd0bf71f60660e2f608ed56e1659c450eb113120',
    chain: 'sepolia',
    label: 'Base Sepolia: L1StandardBridge',
    category: 'BRIDGE',
    source: 'https://docs.base.org/base-chain/network-information/base-contracts',
    confidence: 'HIGH',
  },
  {
    address: '0x49f53e41452c74589e85ca1677426ba426459e85',
    chain: 'sepolia',
    label: 'Base Sepolia: OptimismPortal',
    category: 'BRIDGE',
    source: 'https://docs.base.org/base-chain/network-information/base-contracts',
    confidence: 'HIGH',
  },
  {
    address: '0xc34855f4de64f1840e5686e64278da901e261f20',
    chain: 'sepolia',
    label: 'Base Sepolia: L1CrossDomainMessenger',
    category: 'BRIDGE',
    source: 'https://docs.base.org/base-chain/network-information/base-contracts',
    confidence: 'HIGH',
  },
  {
    address: '0xfbb0621e0b23b5478b630bd55a5f21f67730b0f1',
    chain: 'sepolia',
    label: 'OP Sepolia: L1StandardBridge',
    category: 'BRIDGE',
    source: 'https://github.com/ethereum-optimism/superchain-registry',
    confidence: 'HIGH',
  },
  {
    address: '0x16fc5058f25648194471939df75cf27a2fdc48bc',
    chain: 'sepolia',
    label: 'OP Sepolia: OptimismPortal',
    category: 'BRIDGE',
    source: 'https://github.com/ethereum-optimism/superchain-registry',
    confidence: 'HIGH',
  },
  {
    address: '0x58cc85b8d04ea49cc6dbd3cbffd00b4b8d6cb3ef',
    chain: 'sepolia',
    label: 'OP Sepolia: L1CrossDomainMessenger',
    category: 'BRIDGE',
    source: 'https://github.com/ethereum-optimism/superchain-registry',
    confidence: 'HIGH',
  },
  {
    address: '0xd83e03d576d23c9aeab8cc44fa98d058d2176d1f',
    chain: 'sepolia',
    label: 'OP Sepolia: L1ERC721Bridge',
    category: 'BRIDGE',
    source: 'https://github.com/ethereum-optimism/superchain-registry',
    confidence: 'HIGH',
  },
  {
    address: '0x3154cf16ccdb4c6d922629664174b904d80f2c35',
    chain: 'mainnet',
    label: 'Base: L1StandardBridge',
    category: 'BRIDGE',
    source: 'https://docs.base.org/base-chain/network-information/base-contracts',
    confidence: 'HIGH',
  },
  {
    address: '0x49048044d57e1c92a77f79988d21fa8faf74e97e',
    chain: 'mainnet',
    label: 'Base: OptimismPortal',
    category: 'BRIDGE',
    source: 'https://docs.base.org/base-chain/network-information/base-contracts',
    confidence: 'HIGH',
  },
  {
    address: '0x866e82a600a1414e583f7f13623f1ac5d58b0afa',
    chain: 'mainnet',
    label: 'Base: L1CrossDomainMessenger',
    category: 'BRIDGE',
    source: 'https://docs.base.org/base-chain/network-information/base-contracts',
    confidence: 'HIGH',
  },
]

const EXCHANGE_SOURCE = 'tradezon/cex-list + ImMike/crypto-wallet-address-labels (both agree)'

/**
 * Centralised-exchange hot wallets on Ethereum mainnet: 100 addresses.
 * huobi 34, poloniex 19, bithumb 11, binance 10, kraken 4, gate.io 3, bitfinex 3, okx 3, mexc 2, coinone 2, hotbit 2, kucoin 2, bittrex 2, bitstamp 1, ftx 1, gemini 1.
 *
 * Every one appears in BOTH source datasets with an agreeing exchange name.
 */
const EXCHANGES: KnownFunderSeedRow[] = [
  { address: '0x001866ae5b3de6caa5a51543fd9fb64f524f5478', chain: 'mainnet', label: 'Binance 9', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x00bdb5699745f5b860228c8f939abf1b9ae374ed', chain: 'mainnet', label: 'Bitstamp 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x0211f3cedbef3143223d3acf0e589747933e8527', chain: 'mainnet', label: 'MXC 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x034f854b44d28e26386c1bc37ff9b20c6380b00d', chain: 'mainnet', label: 'Huobi 26', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x0536806df512d6cdde913cf95c9886f65b1d3462', chain: 'mainnet', label: 'Poloniex: GNT', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x0577a79cfc63bbc0df38833ff4c4a3bf2095b404', chain: 'mainnet', label: 'Huobi 27', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x0681d8db095565fe8a346fa0277bffde9c0edbbf', chain: 'mainnet', label: 'Binance 4', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13', chain: 'mainnet', label: 'Kraken 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x0c6c34cdd915845376fb5407e0895196c9dd4eec', chain: 'mainnet', label: 'Huobi 28', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x0d0707963952f2fba59dd06f2b425ace40b492fe', chain: 'mainnet', label: 'Gate.io 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x1062a747393198f70f71ec65a582423dba7e5ab3', chain: 'mainnet', label: 'Huobi 9', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x1151314c646ce4e0efd76d1af4760ae66a9fe30f', chain: 'mainnet', label: 'Bitfinex 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x137ad9c4777e1d36e4b605e745e8f37b2b62e9c5', chain: 'mainnet', label: 'Huobi 24', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x15878e87c685f866edfaf454be6dc06fa517b35b', chain: 'mainnet', label: 'Bithumb 7', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x167a9333bf582556f35bd4d16a7e80e191aa6476', chain: 'mainnet', label: 'Coinone 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x186549a4ae594fc1f70ba4cffdac714b405be3f9', chain: 'mainnet', label: 'Bithumb 10', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x18916e1a2933cb349145a280473a5de8eb6630cb', chain: 'mainnet', label: 'Huobi 21', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x1c4b70a3968436b9a0a9cf5205c787eb81bb558c', chain: 'mainnet', label: 'Gate.io 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x1e2fcfd26d36183f1a5d90f0e6296915b02bcb40', chain: 'mainnet', label: 'Coinone 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x2140efd7ba31169c69dfff6cdc66c542f0211825', chain: 'mainnet', label: 'Bithumb 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x229b5c097f9b35009ca1321ad2034d4b3d5070f6', chain: 'mainnet', label: 'Huobi 18', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3', chain: 'mainnet', label: 'Okex 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0', chain: 'mainnet', label: 'Kraken 4', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x274f3c32c90517975e29dfc209a23f315c1e5fc7', chain: 'mainnet', label: 'Hotbit 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x28ffe35688ffffd0659aee2e34778b0ae4e193ad', chain: 'mainnet', label: 'Huobi 33', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', chain: 'mainnet', label: 'Kraken 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x2b5634c42055806a59e9107ed44d43c426e58258', chain: 'mainnet', label: 'KuCoin 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x2fa2bc2ce6a4f92952921a4caa46b3727d24a1ec', chain: 'mainnet', label: 'Poloniex: BNT', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2', chain: 'mainnet', label: 'FTX Exchange', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x3052cd6bf951449a984fe4b5a38b46aef9455c8e', chain: 'mainnet', label: 'Bithumb 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x31a2feb9b5d3b5f4e76c71d6c92fc46ebb3cb1c1', chain: 'mainnet', label: 'Poloniex: CVC', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x31d03f07178bcd74f9099afebd23b0ae30184ab5', chain: 'mainnet', label: 'Bithumb 8', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x32598293906b5b17c27d657db3ad2c9b3f3e4265', chain: 'mainnet', label: 'Huobi 13', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x32be343b94f860124dc4fee278fdcbd38c102d88', chain: 'mainnet', label: 'Poloniex 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x36b01066b7fa4a0fdb2968ea0256c848e9135674', chain: 'mainnet', label: 'Poloniex: OMG', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be', chain: 'mainnet', label: 'Binance 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x46705dfff24256421a05d056c29e81bdc09723b8', chain: 'mainnet', label: 'Huobi 12', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x48d466b7c0d32b61e8a82cd2bcf060f7c3f966df', chain: 'mainnet', label: 'Poloniex: GNO', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x4d77a1144dc74f26838b69391a6d3b1e403d0990', chain: 'mainnet', label: 'Huobi 32', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x4e9ce36e442e55ecd9025b9a6e0d88485d628a67', chain: 'mainnet', label: 'Binance 6', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x5401dbf7da53e1c9dbf484e3d69505815f2f5e6e', chain: 'mainnet', label: 'Huobi 25', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x564286362092d8e7936f0549571a803b203aaced', chain: 'mainnet', label: 'Binance 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x5861b8446a2f6e19a067874c133f04c578928727', chain: 'mainnet', label: 'Huobi 14', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x5c985e89dde482efe97ea9f1950ad149eb73829b', chain: 'mainnet', label: 'Huobi 5', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x65f9b2e4d7aaeb40ffea8c6f5844d5ad7da257e0', chain: 'mainnet', label: 'Poloniex: NXC', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x66f820a414680b5bcda5eeca5dea238543f42054', chain: 'mainnet', label: 'Bittrex 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b', chain: 'mainnet', label: 'Huobi 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x6795cf8eb25585eadc356ae32ac6641016c550f2', chain: 'mainnet', label: 'Poloniex: SNT', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x689c56aef474df92d44a1b70850f808488f9769c', chain: 'mainnet', label: 'KuCoin 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x6b71834d65c5c4d8ed158d54b47e6ea4ff4e5437', chain: 'mainnet', label: 'Poloniex: FOAM', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', chain: 'mainnet', label: 'Okex 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x6f48a3e70f0251d1e83a989e62aaa2281a6d5380', chain: 'mainnet', label: 'Huobi 22', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x6f803466bcd17f44fa18975bf7c509ba64bf3825', chain: 'mainnet', label: 'Poloniex: USDC', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x742d35cc6634c0532925a3b844bc454e4438f44e', chain: 'mainnet', label: 'Bitfinex 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88', chain: 'mainnet', label: 'MXC 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x7793cd85c11a924478d358d49b05b37e91b5810f', chain: 'mainnet', label: 'Gate.io 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x794d28ac31bcb136294761a556b68d2634094153', chain: 'mainnet', label: 'Huobi 29', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x7ef35bb398e0416b81b019fea395219b65c52164', chain: 'mainnet', label: 'Huobi 17', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x8533a0bd9310eb63e7cc8e1116c18a3d67b1976a', chain: 'mainnet', label: 'Hotbit 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa', chain: 'mainnet', label: 'Bitfinex 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x88d34944cf554e9cccf4a24292d891f620e9c94f', chain: 'mainnet', label: 'Bithumb 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x8d451ae5ee8f557a9ce7a9d7be8a8cb40002d5cb', chain: 'mainnet', label: 'Poloniex: KNC', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x90e9ddd9d8d5ae4e3763d0cf856c97594dea7325', chain: 'mainnet', label: 'Huobi 20', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0x926fc576b7facf6ae2d08ee2d4734c134a743988', chain: 'mainnet', label: 'Huobi 15', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xa0ff1e0f30b5dda2dc01e7e828290bc72b71e57d', chain: 'mainnet', label: 'Bithumb 4', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xa7efae728d2936e78bda97dc267687568dd593f3', chain: 'mainnet', label: 'Okex 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xa8660c8ffd6d578f657b72c0c811284aef0b735e', chain: 'mainnet', label: 'Huobi 8', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xa910f92acdaf488fa6ef02174fb86208ad7722ba', chain: 'mainnet', label: 'Poloniex 4', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xaa9fa73dfe17ecaa2c89b39f0bb2779613c5fc3b', chain: 'mainnet', label: 'Poloniex: BAT', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xab11204cfeaccffa63c2d23aef2ea9accdb0a0d5', chain: 'mainnet', label: 'Poloniex: REP', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xab5c66752a9e8167967685f1450532fb96d5d24f', chain: 'mainnet', label: 'Huobi 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xab83d182f3485cf1d6ccdd34c7cfef95b4c08da4', chain: 'mainnet', label: 'Binance JEX', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xadb2b42f6bd96f5c65920b9ac88619dce4166f94', chain: 'mainnet', label: 'Huobi 7', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xb4460b75254ce0563bb68ec219208344c7ea838c', chain: 'mainnet', label: 'Bithumb 6', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xb4cd0386d2db86f30c1a11c2b8c4f4185c1dade9', chain: 'mainnet', label: 'Huobi 31', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xb794f5ea0ba39494ce839613fffba74279579268', chain: 'mainnet', label: 'Poloniex 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xbd2ec7c608a06fe975dbdca729e84dedb34ecc21', chain: 'mainnet', label: 'Poloniex: LOOM', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8', chain: 'mainnet', label: 'Binance 7', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xc0e30823e5e628df8bc9bf2636a347e1512f0ecb', chain: 'mainnet', label: 'Poloniex: MANA', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xc1da8f69e4881efe341600620268934ef01a3e63', chain: 'mainnet', label: 'Bithumb 5', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xcac725bef4f114f728cbcfd744a731c2a463c3fc', chain: 'mainnet', label: 'Huobi 34', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xd24400ae8bfebb18ca49be86258a3c749cf46853', chain: 'mainnet', label: 'Gemini 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xd273bd546b11bd60214a2f9d71f22a088aafe31b', chain: 'mainnet', label: 'Bithumb 11', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xd551234ae421e3bcba99a0da6d736074f22192ff', chain: 'mainnet', label: 'Binance 2', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xd8a83b72377476d0a66683cde20a8aad0b628713', chain: 'mainnet', label: 'Huobi 19', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xdc76cd25977e0a5ae17155770273ad58648900d3', chain: 'mainnet', label: 'Huobi 6', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xe853c56864a2ebe4576a807d26fdc4a0ada51919', chain: 'mainnet', label: 'Kraken 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xe93381fb4c4f14bda253907b18fad305d799241a', chain: 'mainnet', label: 'Huobi 10', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xead6be34ce315940264519f250d8160f369fa5cd', chain: 'mainnet', label: 'Poloniex: ZRX', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xed48dc0628789c2956b1e41726d062a86ec45bff', chain: 'mainnet', label: 'Bithumb 9', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xeec606a66edb6f497662ea31b5eb1610da87ab5f', chain: 'mainnet', label: 'Huobi 16', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xeee28d484628d41a82d01e21d12e2e78d69920da', chain: 'mainnet', label: 'Huobi 4', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xf056f435ba0cc4fcd2f1b17e3766549ffc404b94', chain: 'mainnet', label: 'Huobi 23', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xf977814e90da44bfa03b6295a0616a897441acec', chain: 'mainnet', label: 'Binance 8', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xfa4b5be3f2f84f56703c42eb22142744e95a2c58', chain: 'mainnet', label: 'Huobi 11', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xfbb1b73c4f0bda4f67dca266ce6ef42f520fbb98', chain: 'mainnet', label: 'Bittrex 1', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xfbf2173154f7625713be22e0504404ebfe021eae', chain: 'mainnet', label: 'Poloniex: STORJ', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xfd54078badd5653571726c3370afb127351a6f26', chain: 'mainnet', label: 'Huobi 30', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xfdb16996831753d5331ff813c29a93c76834a0ad', chain: 'mainnet', label: 'Huobi 3', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
  { address: '0xfe9e8709d3215310075d67e3ed32a380ccf451c8', chain: 'mainnet', label: 'Binance 5', category: 'EXCHANGE', source: EXCHANGE_SOURCE, confidence: 'MEDIUM' },
]

export const KNOWN_FUNDER_SEED_ROWS: readonly KnownFunderSeedRow[] = [...BRIDGES, ...EXCHANGES]
