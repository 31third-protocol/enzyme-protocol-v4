import { AddressLike, randomAddress } from '@enzymefinance/ethers';
import { ComptrollerLib, FundDeployer, ReleaseStatusTypes, StandardToken, VaultLib } from '@enzymefinance/protocol';
import {
  createNewFund,
  generateFeeManagerConfigWithMockFees,
  generatePolicyManagerConfigWithMockPolicies,
  createFundDeployer,
  deployProtocolFixture,
  ProtocolDeployment,
} from '@enzymefinance/testutils';
import { BigNumber, BytesLike, constants } from 'ethers';

let fork: ProtocolDeployment;

describe('unhappy paths', () => {
  let fundDeployer: FundDeployer;

  beforeEach(async () => {
    fork = await deployProtocolFixture();
    fundDeployer = fork.deployment.fundDeployer;
  });

  // No empty _fundOwner validated by VaultLib.init()
  // No bad _denominationAsset validated by ComptrollerLib.init()

  it('does not allow the release status to be Paused', async () => {
    // Pause the release
    await fundDeployer.setReleaseStatus(ReleaseStatusTypes.Paused);

    await expect(
      fundDeployer.createNewFund(randomAddress(), '', fork.config.weth, 0, constants.HashZero, constants.HashZero),
    ).rejects.toBeRevertedWith('Release is not Live');
  });

  it('does not allow the release status to be PreLaunch', async () => {
    const {
      assetFinalityResolver,
      chainlinkPriceFeed,
      externalPositionManager,
      dispatcher,
      feeManager,
      integrationManager,
      policyManager,
      valueInterpreter,
      vaultLib,
    } = fork.deployment;
    const nonLiveFundDeployer = await createFundDeployer({
      deployer: fork.deployer,
      assetFinalityResolver,
      chainlinkPriceFeed,
      externalPositionManager,
      dispatcher,
      feeManager,
      integrationManager,
      policyManager,
      valueInterpreter,
      vaultLib,
      setReleaseStatusLive: false, // Do NOT set release status to Live
      setOnDispatcher: true, // Do set as the current release on the Dispatcher
    });

    await expect(
      nonLiveFundDeployer.createNewFund(
        randomAddress(),
        '',
        fork.config.weth,
        0,
        constants.HashZero,
        constants.HashZero,
      ),
    ).rejects.toBeRevertedWith('Release is not Live');
  });
});

describe('happy paths', () => {
  describe('No extension config', () => {
    let fundDeployer: FundDeployer;
    let comptrollerProxy: ComptrollerLib, vaultProxy: VaultLib;
    let fundName: string, fundOwner: AddressLike, denominationAsset: StandardToken, sharesActionTimelock: BigNumber;

    beforeAll(async () => {
      fork = await deployProtocolFixture();

      const [signer] = fork.accounts;
      fundDeployer = fork.deployment.fundDeployer;

      fundOwner = randomAddress();
      fundName = 'My Fund';
      denominationAsset = new StandardToken(fork.config.primitives.usdc, provider);
      sharesActionTimelock = BigNumber.from(123);

      // Note that events are asserted within helper
      const fundRes = await createNewFund({
        signer,
        fundDeployer,
        fundOwner,
        fundName,
        denominationAsset,
        sharesActionTimelock,
      });

      comptrollerProxy = fundRes.comptrollerProxy;
      vaultProxy = fundRes.vaultProxy;
    });

    it('does NOT call the lifecycle configureExtensions() function', async () => {
      expect(comptrollerProxy.configureExtensions).not.toHaveBeenCalledOnContract();
    });

    it('correctly calls the lifecycle setVaultProxy() function', async () => {
      expect(comptrollerProxy.setVaultProxy).toHaveBeenCalledOnContractWith(vaultProxy);
    });

    it('correctly calls the lifecycle activate() function', async () => {
      expect(comptrollerProxy.activate).toHaveBeenCalledOnContractWith(false);
    });

    it('sets the correct ComptrollerProxy state values', async () => {
      expect(await comptrollerProxy.getDenominationAsset()).toMatchAddress(denominationAsset);
      expect(await comptrollerProxy.getSharesActionTimelock()).toEqBigNumber(sharesActionTimelock);
      expect(await comptrollerProxy.getVaultProxy()).toMatchAddress(vaultProxy);
    });

    it('sets the correct VaultProxy state values', async () => {
      expect(await vaultProxy.getAccessor()).toMatchAddress(comptrollerProxy);
      expect(await vaultProxy.getOwner()).toMatchAddress(fundOwner);
      expect(await vaultProxy.name()).toEqual(fundName);
    });
  });

  describe('Policies only (no fees)', () => {
    let fundDeployer: FundDeployer;
    let comptrollerProxy: ComptrollerLib;
    let policyManagerConfig: BytesLike;

    beforeAll(async () => {
      fork = await deployProtocolFixture();

      const [signer] = fork.accounts;
      fundDeployer = fork.deployment.fundDeployer;

      policyManagerConfig = await generatePolicyManagerConfigWithMockPolicies({
        deployer: fork.deployer,
        policyManager: fork.deployment.policyManager,
      });

      // Note that events are asserted within helper
      const fundRes = await createNewFund({
        signer,
        fundDeployer,
        denominationAsset: new StandardToken(fork.config.primitives.usdc, provider),
        policyManagerConfig,
      });

      comptrollerProxy = fundRes.comptrollerProxy;
    });

    it('correctly calls the lifecycle configureExtensions() function with only policies data', async () => {
      expect(comptrollerProxy.configureExtensions).toHaveBeenCalledOnContractWith('0x', policyManagerConfig);
    });

    // Other assertions already covered by first test case
  });

  describe('Fees only (no policies)', () => {
    let fundDeployer: FundDeployer;
    let comptrollerProxy: ComptrollerLib;
    let feeManagerConfig: BytesLike;

    beforeAll(async () => {
      fork = await deployProtocolFixture();

      const [signer] = fork.accounts;
      fundDeployer = fork.deployment.fundDeployer;

      feeManagerConfig = await generateFeeManagerConfigWithMockFees({
        deployer: fork.deployer,
        feeManager: fork.deployment.feeManager,
      });

      // Note that events are asserted within helper
      const fundRes = await createNewFund({
        signer,
        fundDeployer,
        denominationAsset: new StandardToken(fork.config.primitives.usdc, provider),
        feeManagerConfig,
      });

      comptrollerProxy = fundRes.comptrollerProxy;
    });

    it('correctly calls the lifecycle configureExtensions() function with only fees data', async () => {
      expect(comptrollerProxy.configureExtensions).toHaveBeenCalledOnContractWith(feeManagerConfig, '0x');
    });

    // Other assertions already covered by first test case
  });
});