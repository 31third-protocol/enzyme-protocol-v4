import { extractEvent, randomAddress } from '@enzymefinance/ethers';
import type { SignerWithAddress } from '@enzymefinance/hardhat';
import type { ComptrollerLib, VaultLib } from '@enzymefinance/protocol';
import {
  addressListRegistryPolicyArgs,
  AddressListUpdateType,
  entranceRateBurnFeeConfigArgs,
  feeManagerConfigArgs,
  managementFeeConfigArgs,
  managementFeeConvertRateToScaledPerSecondRate,
  performanceFeeConfigArgs,
  StandardToken,
} from '@enzymefinance/protocol';
import type { ProtocolDeployment } from '@enzymefinance/testutils';
import {
  addNewAssetsToFund,
  buyShares,
  createNewFund,
  deployProtocolFixture,
  getAssetUnit,
  redeemSharesInKind,
  seedAccount,
  uniswapV2TakeOrder,
} from '@enzymefinance/testutils';
import type { BigNumberish } from 'ethers';
import { BigNumber, utils } from 'ethers';

const FIVE_PERCENT = BigNumber.from(500);
const TEN_PERCENT = BigNumber.from(1000);
const ONE_HUNDRED_PERCENT = BigNumber.from(10000);

describe.each([['weth' as const], ['usdc' as const]])(
  'Walkthrough for %s as denomination asset',
  (denominationAssetId) => {
    let fork: ProtocolDeployment;
    let manager: SignerWithAddress;
    let investor: SignerWithAddress;
    let anotherInvestor: SignerWithAddress;

    let comptrollerProxy: ComptrollerLib;
    let vaultProxy: VaultLib;
    let denominationAsset: StandardToken;
    let denominationAssetDecimals: BigNumberish;

    beforeAll(async () => {
      fork = await deployProtocolFixture();

      manager = fork.accounts[1];
      investor = fork.accounts[2];
      anotherInvestor = fork.accounts[3];

      denominationAsset = new StandardToken(
        denominationAssetId === 'weth' ? fork.config.weth : fork.config.primitives[denominationAssetId],
        provider,
      );
      denominationAssetDecimals = await denominationAsset.decimals();

      // Seed investors with denomination asset
      const denominationAssetSeedAmount = (await getAssetUnit(denominationAsset)).mul(100);

      await seedAccount({ account: investor, amount: denominationAssetSeedAmount, provider, token: denominationAsset });
      await seedAccount({
        account: anotherInvestor,
        amount: denominationAssetSeedAmount,
        provider,
        token: denominationAsset,
      });
    });

    it('creates a new fund', async () => {
      // fees
      const scaledPerSecondRate = managementFeeConvertRateToScaledPerSecondRate(utils.parseEther('0.01')); // 1%
      const managementFeeSettings = managementFeeConfigArgs({ scaledPerSecondRate });
      const performanceFeeSettings = performanceFeeConfigArgs({
        rate: TEN_PERCENT,
      });
      const entranceRateBurnFeeSettings = entranceRateBurnFeeConfigArgs({ rate: FIVE_PERCENT });

      const feeManagerConfig = feeManagerConfigArgs({
        fees: [fork.deployment.managementFee, fork.deployment.performanceFee, fork.deployment.entranceRateBurnFee],
        settings: [managementFeeSettings, performanceFeeSettings, entranceRateBurnFeeSettings],
      });

      // TODO: add policies

      const createFundTx = await createNewFund({
        denominationAsset,
        feeManagerConfig,
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner: manager,
        signer: manager,
      });

      comptrollerProxy = createFundTx.comptrollerProxy;
      vaultProxy = createFundTx.vaultProxy;

      expect(createFundTx.receipt).toMatchGasSnapshot(denominationAssetId);
    });

    it('enables the AllowedDepositRecipientsPolicy policy for the fund', async () => {
      const enabled = await fork.deployment.policyManager
        .connect(manager)
        .enablePolicyForFund.args(
          comptrollerProxy.address,
          fork.deployment.allowedDepositRecipientsPolicy,
          addressListRegistryPolicyArgs({
            newListsArgs: [
              {
                initialItems: [randomAddress(), randomAddress(), investor.address],
                updateType: AddressListUpdateType.None,
              },
            ],
          }),
        )
        .send();

      expect(enabled).toBeReceipt();
    });

    it('buys shares of a fund', async () => {
      const buySharesTx = await buyShares({
        buyer: investor,
        comptrollerProxy,
        denominationAsset,
        provider,
      });

      const rate = FIVE_PERCENT;
      const rateDivisor = ONE_HUNDRED_PERCENT;
      const expectedFee = utils.parseUnits('1', denominationAssetDecimals).mul(rate).div(rateDivisor);

      expect(await vaultProxy.balanceOf(investor)).toBeGteBigNumber(
        utils.parseUnits('1', denominationAssetDecimals).sub(expectedFee),
      );

      expect(buySharesTx).toMatchGasSnapshot(denominationAssetId);
    });

    it('buys more shares of a fund', async () => {
      const previousBalance = await vaultProxy.balanceOf(investor);

      const minSharesAmount = utils.parseUnits('0.00001', denominationAssetDecimals);
      const buySharesTx = await buyShares({
        buyer: investor,
        comptrollerProxy,
        denominationAsset,
        provider,
      });

      expect(await vaultProxy.balanceOf(investor)).toBeGteBigNumber(minSharesAmount.add(previousBalance));

      expect(buySharesTx).toMatchGasSnapshot(denominationAssetId);
    });

    it('calculates the GAV of the fund with only the denomination asset', async () => {
      const calcGavTx = await comptrollerProxy.calcGav();

      expect(calcGavTx).toMatchGasSnapshot(denominationAssetId);
    });

    it('seeds the fund with all more assets', async () => {
      const assets = [
        new StandardToken(fork.config.primitives.bat, provider),
        new StandardToken(fork.config.primitives.bnb, provider),
        new StandardToken(fork.config.primitives.bnt, provider),
        new StandardToken(fork.config.primitives.comp, provider),
        new StandardToken(fork.config.primitives.dai, provider),
        new StandardToken(fork.config.primitives.link, provider),
        new StandardToken(fork.config.primitives.mana, provider),
        new StandardToken(fork.config.primitives.mln, provider),
        new StandardToken(fork.config.primitives.ren, provider),
        new StandardToken(fork.config.primitives.rep, provider),
        new StandardToken(fork.config.primitives.susd, provider),
        new StandardToken(fork.config.primitives.uni, provider),
        new StandardToken(fork.config.primitives.usdt, provider),
        new StandardToken(fork.config.primitives.zrx, provider),
      ];

      await addNewAssetsToFund({
        assets,
        comptrollerProxy,
        integrationManager: fork.deployment.integrationManager,
        provider,
        signer: manager,
        amounts: await Promise.all(assets.map((asset) => getAssetUnit(asset))),
      });
    });

    it('seeds the fund with cTokens', async () => {
      const compoundAssets = [
        new StandardToken(fork.config.compound.ctokens.ccomp, provider),
        new StandardToken(fork.config.compound.ctokens.cdai, provider),
        new StandardToken(fork.config.compound.ceth, provider),
        new StandardToken(fork.config.compound.ctokens.cusdc, provider),
        new StandardToken(fork.config.compound.ctokens.cuni, provider),
      ];

      await addNewAssetsToFund({
        provider,
        assets: compoundAssets,
        comptrollerProxy,
        integrationManager: fork.deployment.integrationManager,
        signer: manager,
        amounts: await Promise.all(compoundAssets.map((asset) => getAssetUnit(asset))),
      });
    });

    it('calculates the GAV of the fund with 20 assets', async () => {
      expect((await vaultProxy.getTrackedAssets()).length).toBe(20);

      const calcGavTx = await comptrollerProxy.calcGav();

      expect(calcGavTx).toMatchGasSnapshot(denominationAssetId);
    });

    it('trades on Uniswap', async () => {
      const receipt = await uniswapV2TakeOrder({
        comptrollerProxy,
        fundOwner: manager,
        integrationManager: fork.deployment.integrationManager,
        minIncomingAssetAmount: BigNumber.from(1),
        outgoingAssetAmount: utils.parseUnits('0.1', denominationAssetDecimals),
        path: [denominationAsset, new StandardToken(fork.config.primitives.dai, provider)],
        provider,
        uniswapV2ExchangeAdapter: fork.deployment.uniswapV2ExchangeAdapter,
        vaultProxy,
      });

      expect(receipt).toMatchGasSnapshot(denominationAssetId);
    });

    it("sends an asset amount to the fund's vault", async () => {
      const gavBefore = await comptrollerProxy.calcGav.args().call();
      const grossShareValueBefore = await comptrollerProxy.calcGrossShareValue.call();

      const asset = new StandardToken(fork.config.primitives.dai, provider);
      const balance = await asset.balanceOf(vaultProxy);
      const amount = balance.add(utils.parseEther('1'));

      await seedAccount({ provider, account: vaultProxy, amount, token: fork.config.primitives.dai });

      const gavAfter = await comptrollerProxy.calcGav.args().call();
      const grossShareValueAfter = await comptrollerProxy.calcGrossShareValue.call();

      expect(gavAfter).toBeGtBigNumber(gavBefore);
      expect(grossShareValueAfter).toBeGtBigNumber(grossShareValueBefore);
    });

    it('redeems some shares of the investor (without fees failure)', async () => {
      const balance = await vaultProxy.balanceOf(investor);
      const redeemQuantity = balance.div(2);

      const redeemed = await redeemSharesInKind({
        comptrollerProxy,
        quantity: redeemQuantity,
        signer: investor,
      });

      const failureEvents = extractEvent(redeemed, 'PreRedeemSharesHookFailed');

      expect(failureEvents.length).toBe(0);

      expect(await vaultProxy.balanceOf(investor)).toEqBigNumber(balance.sub(redeemQuantity));

      expect(redeemed).toMatchGasSnapshot(denominationAssetId);
    });

    it("sends an asset amount to the fund's vault again", async () => {
      const gavBefore = await comptrollerProxy.calcGav.args().call();
      const grossShareValueBefore = await comptrollerProxy.calcGrossShareValue.call();

      const token = new StandardToken(fork.config.primitives.zrx, provider);
      const balance = await token.balanceOf(vaultProxy);
      const amount = balance.add(utils.parseEther('1'));

      await seedAccount({ provider, account: vaultProxy, amount, token: fork.config.primitives.zrx });

      const gavAfter = await comptrollerProxy.calcGav.args().call();
      const grossShareValueAfter = await comptrollerProxy.calcGrossShareValue.call();

      expect(gavAfter).toBeGtBigNumber(gavBefore);
      expect(grossShareValueAfter).toBeGtBigNumber(grossShareValueBefore);
    });

    it('changes the AllowedDepositRecipientsPolicy', async () => {
      await fork.deployment.policyManager
        .connect(manager)
        .updatePolicySettingsForFund.args(
          comptrollerProxy.address,
          fork.deployment.allowedDepositRecipientsPolicy,
          addressListRegistryPolicyArgs({
            newListsArgs: [{ initialItems: [anotherInvestor], updateType: AddressListUpdateType.None }],
          }),
        )
        .send();
    });

    it('buy shares: max assets', async () => {
      const buySharesTx = await buyShares({
        buyer: anotherInvestor,
        comptrollerProxy,
        denominationAsset,
        provider,
      });

      expect(buySharesTx).toMatchGasSnapshot(denominationAssetId);
    });

    it('redeems all remaining shares of the first investor (without fees failure)', async () => {
      const redeemed = await redeemSharesInKind({
        comptrollerProxy,
        signer: investor,
      });

      const failureEvents = extractEvent(redeemed, 'PreRedeemSharesHookFailed');

      expect(failureEvents.length).toBe(0);

      expect(await vaultProxy.balanceOf(investor)).toEqBigNumber(utils.parseEther('0'));

      expect(redeemed).toMatchGasSnapshot(denominationAssetId);
    });
  },
);
