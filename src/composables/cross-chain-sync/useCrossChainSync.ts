import { Network } from '@/lib/config';
import { useOmniEscrowLocksQuery } from '../queries/useOmniEscrowLocksQuery';
import { useVotingEscrowLocksQuery } from '../queries/useVotingEscrowQuery';
import useWeb3 from '@/services/web3/useWeb3';
import { configService } from '@/services/config/config.service';
import { OmniVotingEscrow } from '@/services/balancer/contracts/contracts/omni-voting-escrow';
import { allEqual } from '@/lib/utils/array';
import BigNumber from 'bignumber.js';

export enum NetworkSyncState {
  Unsynced = 'Unsynced',
  Syncing = 'Syncing',
  Synced = 'Synced',
}

interface EscrowLockData {
  bias: string;
  slope: string;
}

export interface NetworknetworksBySyncState {
  synced: Network[];
  unsynced: Network[];
}

export type L2VeBalBalances = Record<number, string> | null;

// all networks that are supported by cross-chain sync feature
export const allNetworks = [
  Network.POLYGON,
  Network.ARBITRUM,
  Network.GNOSIS,
  Network.OPTIMISM,
];

// https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
export const LayerZeroNetworkId = {
  [Network.POLYGON]: 109,
  [Network.ARBITRUM]: 110,
  [Network.OPTIMISM]: 111,
};

export function useCrossChainSync() {
  const { account, getSigner } = useWeb3();

  /**
   * omniVotingEscrowLocks contains the user's veBAL data that is known by the bridge contract
   * it is used to determine sync status to l2 networks
   * slope and bias is how a user's "balance" is stored on the smart contract
   */
  const {
    data: omniEscrowResponse,
    isLoading: isLoadingOmniEscrow,
    refetch: refetchOmniEscrow,
  } = useOmniEscrowLocksQuery(account);

  // if omniEscrowLocks is empty, then all networks are unsynced
  const allNetworksUnsynced = computed(
    () => omniEscrowResponse.value?.omniVotingEscrowLocks.length === 0
  );

  const omniEscrowLocks = computed(() => {
    if (allNetworksUnsynced.value) return null;

    const omniVotingEscrowLocks =
      omniEscrowResponse.value?.omniVotingEscrowLocks[0];
    return omniVotingEscrowLocks;
  });

  /**
   * smart contracts can direct their veBAL boost to a different address on L2
   * for regular UI users, remoteUser will be the same as localUser
   */
  const remoteUser = computed(() => {
    return omniEscrowLocks.value?.remoteUser;
  });

  /**
   * votingEscrowLocks contains the user's original veBAL data
   * slope and bias is how a user's "balance" is stored on the smart contract
   */
  const {
    data: mainnetVotingEscrowResponse,
    isLoading: isLoadingVotingEscrow,
    refetch: refetchVotingEscrow,
  } = useVotingEscrowLocksQuery(Network.MAINNET, account);

  const {
    data: arbitrumVotingEscrowResponse,
    isLoading: isLoadingVotingEscrowArbitrum,
    refetch: refetchVotingEscrowArbitrum,
  } = useVotingEscrowLocksQuery(Network.ARBITRUM, remoteUser);

  const votingEscrowLocks = computed(() => {
    const votingEscrowLocks =
      mainnetVotingEscrowResponse.value?.votingEscrowLocks[0];
    const votingEscrowLocksArbitrum =
      arbitrumVotingEscrowResponse.value?.votingEscrowLocks[0];

    if (!votingEscrowLocks || !votingEscrowLocksArbitrum) return null;

    return {
      [Network.MAINNET]: votingEscrowLocks,
      [Network.ARBITRUM]: votingEscrowLocksArbitrum,
    };
  });

  const isLoading = computed(() => {
    if (allNetworksUnsynced.value) return false;
    return (
      isLoadingOmniEscrow.value ||
      isLoadingVotingEscrow.value ||
      isLoadingVotingEscrowArbitrum.value
    );
  });

  const networksSyncState = computed(() => {
    if (allNetworksUnsynced.value) {
      return {
        [Network.ARBITRUM]: NetworkSyncState.Unsynced,
        [Network.OPTIMISM]: NetworkSyncState.Unsynced,
        [Network.GNOSIS]: NetworkSyncState.Unsynced,
        [Network.POLYGON]: NetworkSyncState.Unsynced,
      };
    }

    if (
      isLoading.value ||
      !omniEscrowLocks.value ||
      !votingEscrowLocks.value?.[Network.MAINNET] ||
      !votingEscrowLocks.value?.[Network.ARBITRUM]
    ) {
      return null;
    }

    const { bias, slope } = omniEscrowLocks.value;
    const { bias: biasVotingEscrow, slope: slopeVotingEscrow } =
      votingEscrowLocks.value[Network.MAINNET];

    const { bias: biasVotingEscrowArb, slope: slopeVotingEscrowArb } =
      votingEscrowLocks.value[Network.ARBITRUM];

    return {
      [Network.ARBITRUM]: getNetworkSyncState(
        { bias, slope },
        { bias: biasVotingEscrow, slope: slopeVotingEscrow },
        { bias: biasVotingEscrowArb, slope: slopeVotingEscrowArb }
      ),
    };
  });

  function getNetworkSyncState(
    omniEscrowData: EscrowLockData,
    votingEscrowMainnet: EscrowLockData,
    votingEscrowNetwork: EscrowLockData
  ) {
    const { bias: biasOmniEscrow, slope: slopeOmniEscrow } = omniEscrowData;
    const { bias: biasVotingEscrow, slope: slopeVotingEscrow } =
      votingEscrowMainnet;
    const { bias: biasVotingEscrowNetwork, slope: slopeVotingEscrowNetwork } =
      votingEscrowNetwork;

    const isSynced =
      allEqual([biasOmniEscrow, biasVotingEscrow, biasVotingEscrowNetwork]) &&
      allEqual([slopeOmniEscrow, slopeVotingEscrow, slopeVotingEscrowNetwork]);

    const isSyncing =
      allEqual([biasOmniEscrow, biasVotingEscrow]) &&
      allEqual([slopeOmniEscrow, slopeVotingEscrow]) &&
      slopeOmniEscrow !== slopeVotingEscrowNetwork &&
      biasOmniEscrow !== biasVotingEscrowNetwork;

    if (isSynced) {
      return NetworkSyncState.Synced;
    }
    if (isSyncing) {
      return NetworkSyncState.Syncing;
    }

    return NetworkSyncState.Unsynced;
  }

  // Returns networks lists by sync state synced/unsynced
  const networksBySyncState = computed<NetworknetworksBySyncState>(() => {
    if (!networksSyncState.value)
      return {
        synced: [],
        unsynced: [],
      };

    return {
      synced: Object.keys(networksSyncState.value)
        .map(v => Number(v))
        .filter(
          network =>
            networksSyncState.value?.[network] === NetworkSyncState.Synced
        ) as Network[],
      unsynced: Object.keys(networksSyncState.value)
        .map(v => Number(v))
        .filter(
          network =>
            networksSyncState.value?.[network] === NetworkSyncState.Unsynced
        ),
      sincing: Object.keys(networksSyncState.value)
        .map(v => Number(v))
        .filter(
          network =>
            networksSyncState.value?.[network] === NetworkSyncState.Syncing
        ),
    };
  });

  // veBAL_balance = bias - slope * (now() - timestamp)
  function calculateVeBAlBalance(
    bias: string,
    slope: string,
    timestamp: number
  ) {
    const x = new BigNumber(slope).multipliedBy(
      Math.floor(Date.now() / 1000) - timestamp
    );
    return new BigNumber(bias).minus(x).toFixed(4).toString();
  }

  const l2VeBalBalances = computed<L2VeBalBalances>(() => {
    if (!votingEscrowLocks.value) return null;

    const {
      bias: biasArb,
      slope: slopeArb,
      timestamp: timestampArb,
    } = votingEscrowLocks.value[Network.ARBITRUM];

    return {
      [Network.ARBITRUM]: calculateVeBAlBalance(
        biasArb,
        slopeArb,
        timestampArb
      ),
    };
  });

  async function sync(network: Network) {
    const contractAddress = configService.network.addresses.omniVotingEscrow;
    if (!contractAddress) throw new Error('No contract address found');
    console.log('contractAddress', contractAddress);
    console.log('network', network);
    const signer = getSigner();
    const omniVotingEscrowContract = new OmniVotingEscrow(contractAddress);

    const tx = await omniVotingEscrowContract.estimateSendUserBalance(
      signer,
      LayerZeroNetworkId[network]
    );
    const { nativeFee } = tx;
    console.log('nativeFee', nativeFee);

    return await omniVotingEscrowContract.sendUserBalance({
      signer,
      userAddress: account.value,
      chainId: LayerZeroNetworkId[network],
      nativeFee,
    });
  }

  async function refetch() {
    await Promise.all([refetchOmniEscrow(), refetchVotingEscrow()]);
    if (remoteUser.value) {
      await refetchVotingEscrowArbitrum();
    }
  }

  return {
    omniEscrowLocks,
    votingEscrowLocks,
    networksSyncState,
    isLoading,
    networksBySyncState,
    l2VeBalBalances,
    sync,
    refetch,
  };
}