import { AddressLike, extractEvent } from '@enzymefinance/ethers';
import {
  ISynthetixAddressResolver,
  ISynthetixExchangeRates,
  ISynthetixProxyERC20,
  ISynthetixSynth,
  StandardToken,
  SynthetixPriceFeed,
} from '@enzymefinance/protocol';
import {
  ProtocolDeployment,
  buyShares,
  createNewFund,
  deployProtocolFixture,
  synthetixAssignExchangeDelegate,
  synthetixResolveAddress,
  synthetixTakeOrder,
} from '@enzymefinance/testutils';
import { BigNumber, constants, utils } from 'ethers';

async function warpBeyondWaitingPeriod() {
  const waitingPeriod = 360;
  await provider.send('evm_increaseTime', [waitingPeriod]);
  await provider.send('evm_mine', []);
}

async function getCurrencyKey(synthProxy: AddressLike) {
  const synth = await new ISynthetixProxyERC20(synthProxy, provider).target();
  return await new ISynthetixSynth(synth, provider).currencyKey();
}

let fork: ProtocolDeployment;
beforeEach(async () => {
  fork = await deployProtocolFixture();
});

describe('derivative gas costs', () => {
  it('adds to calcGav for weth-denominated fund', async () => {
    const weth = new StandardToken(fork.config.weth, whales.weth);
    const susd = new StandardToken(fork.config.primitives.susd, whales.susd);
    const incomingAsset = new StandardToken(fork.config.synthetix.synths.sbtc, provider);
    const [fundOwner, investor] = fork.accounts;
    const synthetixAddressResolver = new ISynthetixAddressResolver(fork.config.synthetix.addressResolver, provider);
    const denominationAsset = weth;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      signer: fundOwner,
      fundOwner,
      fundDeployer: fork.deployment.fundDeployer,
      denominationAsset,
    });

    // Delegate SynthetixAdapter to exchangeOnBehalf of VaultProxy
    await synthetixAssignExchangeDelegate({
      comptrollerProxy,
      addressResolver: synthetixAddressResolver,
      fundOwner,
      delegate: fork.deployment.synthetixAdapter,
    });

    const initialTokenAmount = utils.parseEther('1');

    // Buy shares to add denomination asset
    await buyShares({
      comptrollerProxy,
      buyer: investor,
      denominationAsset,
      investmentAmount: initialTokenAmount,
      seedBuyer: true,
    });

    // Calc base cost of calcGav with already tracked assets
    const calcGavBaseGas = (await comptrollerProxy.calcGav(true)).gasUsed;

    // Seed fund and execute Synthetix order
    await susd.transfer(vaultProxy, initialTokenAmount);
    await synthetixTakeOrder({
      comptrollerProxy,
      vaultProxy,
      integrationManager: fork.deployment.integrationManager,
      fundOwner,
      synthetixAdapter: fork.deployment.synthetixAdapter,
      outgoingAsset: susd,
      outgoingAssetAmount: initialTokenAmount,
      incomingAsset,
      minIncomingAssetAmount: BigNumber.from(1),
    });

    await warpBeyondWaitingPeriod();

    // Get the calcGav() cost including the synth token
    const calcGavWithToken = await comptrollerProxy.calcGav(true);

    // Assert gas
    expect(calcGavWithToken).toCostAround(calcGavBaseGas.add(183000));
  });
});

describe('constructor', () => {
  it('sets state vars', async () => {
    const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

    expect(await synthetixPriceFeed.getAddressResolver()).toMatchAddress(fork.config.synthetix.addressResolver);
    expect(await synthetixPriceFeed.getSUSD()).toMatchAddress(fork.config.primitives.susd);

    // TODO: can check this more precisely by calling Synthetix
    for (const synth of Object.values(fork.config.synthetix.synths)) {
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(synth)).not.toBe(constants.HashZero);
    }

    // FundDeployerOwnerMixin
    expect(await synthetixPriceFeed.getFundDeployer()).toMatchAddress(fork.deployment.fundDeployer);
  });
});

describe('calcUnderlyingValues', () => {
  // TODO: Do not use a mock contract for these.
  xit('revert on invalid rate', async () => {
    /*
    const {
    deployer,
    addressResolver: addressResolverAddress,
    synthetixPriceFeed,
    newSynth1,
    newSynth1CurrencyKey,
    } = await provider.snapshot(snapshot);
    const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

    await synthetixPriceFeed.addSynths([newSynth1]);

    // const addressResolver = new MockSynthetixIntegratee(addressResolverAddress, deployer);
    const synthetixAddressResolver = new ISynthetixAddressResolver(fork.config.synthetix.addressResolver, provider);
    const exchangeRatesAddress = await addressResolver.requireAndGetAddress(
      utils.formatBytes32String('ExchangeRates'),
      '',
    );

    const exchangeRates = new MockSynthetixPriceSource(exchangeRatesAddress, deployer);
    await exchangeRates.setRate(newSynth1CurrencyKey, '0');

    const calcUnderlyingValues = synthetixPriceFeed.calcUnderlyingValues.args(newSynth1, utils.parseEther('1')).call();
    await expect(calcUnderlyingValues).rejects.toBeRevertedWith('calcUnderlyingValues: _derivative rate is not valid');
    */
  });

  it('returns rate for underlying token', async () => {
    const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;
    const sbtc = new StandardToken(fork.config.synthetix.synths.sbtc, provider);
    const susd = new StandardToken(fork.config.primitives.susd, provider);

    const exchangeRates = await synthetixResolveAddress({
      addressResolver: new ISynthetixAddressResolver(fork.config.synthetix.addressResolver, provider),
      name: 'ExchangeRates',
    });

    const synthUnit = utils.parseEther('1');

    const synthetixExchangeRate = new ISynthetixExchangeRates(exchangeRates, provider);
    await synthetixPriceFeed.calcUnderlyingValues(sbtc, synthUnit);

    // Synthetix rates
    const { '0': expectedRate } = await synthetixExchangeRate.rateAndInvalid(utils.formatBytes32String('sBTC'));
    const expectedAmount = synthUnit.mul(expectedRate).div(synthUnit); // i.e., just expectedRate

    // Internal feed rates
    const feedRate = await synthetixPriceFeed.calcUnderlyingValues.args(sbtc, synthUnit).call();
    expect(feedRate).toMatchFunctionOutput(synthetixPriceFeed.calcUnderlyingValues.fragment, {
      underlyingAmounts_: [expectedAmount],
      underlyings_: [susd],
    });

    // Assert gas
    const calcUnderlyingValuesTx = await synthetixPriceFeed.calcUnderlyingValues(sbtc, synthUnit);
    expect(calcUnderlyingValuesTx).toCostAround(97000);
  });
});

describe('isSupportedAsset', () => {
  it('return false on invalid synth', async () => {
    const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

    const isSupportedAsset = await synthetixPriceFeed.isSupportedAsset(fork.config.primitives.dai);

    expect(isSupportedAsset).toBe(false);
  });

  it('returns true on valid synth', async () => {
    const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

    const isSupportedAsset = await synthetixPriceFeed.isSupportedAsset(fork.config.synthetix.synths.sbtc);

    expect(isSupportedAsset).toBe(true);
  });
});

describe('synths registry', () => {
  describe('addSynths', () => {
    it('does not allow a random caller', async () => {
      const [arbitraryUser] = fork.accounts;
      const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

      await expect(
        synthetixPriceFeed
          .connect(arbitraryUser)
          .addSynths([fork.config.synthetix.synths.sbnb, fork.config.synthetix.synths.seth]),
      ).rejects.toBeRevertedWith('Only the FundDeployer owner can call this function');
    });

    it('does not allow an empty _synths param', async () => {
      const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

      await expect(synthetixPriceFeed.addSynths([])).rejects.toBeRevertedWith('Empty _synths');
    });

    it('does not allow an already-set Synth', async () => {
      const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

      await expect(synthetixPriceFeed.addSynths([fork.config.synthetix.synths.sbtc])).rejects.toBeRevertedWith(
        'Value already set',
      );
    });

    it.todo('does not allow an asset without a currencyKey');

    it('adds multiple Synths and emits an event per added Synth', async () => {
      const newSynth1 = fork.config.synthetix.synths.seth;
      const newSynth2 = fork.config.synthetix.synths.sbtc;

      const synthetixPriceFeed = await SynthetixPriceFeed.deploy(
        fork.deployer,
        fork.deployment.dispatcher,
        fork.config.synthetix.addressResolver,
        fork.config.synthetix.susd,
        [],
      );

      // The Synths should not be supported assets initially
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(false);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(false);

      // Add the new Synths
      const addSynthsTx = await synthetixPriceFeed.addSynths([newSynth1, newSynth2]);

      const newSynth1CurrencyKey = await getCurrencyKey(newSynth1);
      const newSynth2CurrencyKey = await getCurrencyKey(newSynth2);

      // The currencyKey should be stored for each Synth
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth1)).toBe(newSynth1CurrencyKey);
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth2)).toBe(newSynth2CurrencyKey);
      expect(
        await synthetixPriceFeed.getCurrencyKeysForSynths([newSynth1, newSynth2]),
      ).toMatchFunctionOutput(synthetixPriceFeed.getCurrencyKeysForSynths, [
        newSynth1CurrencyKey,
        newSynth2CurrencyKey,
      ]);

      // The tokens should now be supported assets
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(true);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(true);

      // The correct event should have been emitted for each Synth
      const events = extractEvent(addSynthsTx, 'SynthAdded');
      expect(events.length).toBe(2);
      expect(events[0]).toMatchEventArgs({
        synth: newSynth1,
        currencyKey: newSynth1CurrencyKey,
      });
      expect(events[1]).toMatchEventArgs({
        synth: newSynth2,
        currencyKey: newSynth2CurrencyKey,
      });
    });
  });

  describe('updateSynthCurrencyKeys', () => {
    it('does not allow an empty _synths param', async () => {
      const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

      await expect(synthetixPriceFeed.updateSynthCurrencyKeys([])).rejects.toBeRevertedWith('Empty _synths');
    });

    it('does not allow an unset Synth', async () => {
      const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

      await expect(synthetixPriceFeed.updateSynthCurrencyKeys([fork.config.primitives.dai])).rejects.toBeRevertedWith(
        'Synth not set',
      );
    });

    it('does not allow a Synth that has the correct currencyKey', async () => {
      const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;

      await expect(
        synthetixPriceFeed.updateSynthCurrencyKeys([fork.config.synthetix.synths.sbtc]),
      ).rejects.toBeRevertedWith('Synth has correct currencyKey');
    });

    xit('updates multiple Synths and emits an event per updated Synth (called by random user)', async () => {
      /*
      const synthetixPriceFeed = fork.deployment.synthetixPriceFeed;
      const [arbitraryUser] = fork.accounts;

      // Add the new Synths so they are supported
      await synthetixPriceFeed.addSynths([newSynth1, newSynth2]);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(true);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(true);

      // Update the Synth currency keys in Synthetix
      const altSynth1CurrencyKey = utils.formatBytes32String('sMOCK1-ALT');
      const altSynth2CurrencyKey = utils.formatBytes32String('sMOCK2-ALT');
      await newSynth1.setCurrencyKey(altSynth1CurrencyKey);
      await newSynth2.setCurrencyKey(altSynth2CurrencyKey);

      // Update the new Synths (from a random user)
      const updateSynthsTx = await synthetixPriceFeed
        .connect(arbitraryUser)
        .updateSynthCurrencyKeys([newSynth1, newSynth2]);

      // The new currencyKey should be stored for each Synth
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth1)).toBe(altSynth1CurrencyKey);
      expect(await synthetixPriceFeed.getCurrencyKeyForSynth(newSynth2)).toBe(altSynth2CurrencyKey);
      expect(
        await synthetixPriceFeed.getCurrencyKeysForSynths([newSynth1, newSynth2]),
      ).toMatchFunctionOutput(synthetixPriceFeed.getCurrencyKeysForSynths, [
        altSynth1CurrencyKey,
        altSynth2CurrencyKey,
      ]);

      // The tokens should still be supported assets
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth1)).toBe(true);
      expect(await synthetixPriceFeed.isSupportedAsset(newSynth2)).toBe(true);

      // The correct event should have been emitted for each Synth
      const events = extractEvent(updateSynthsTx, 'SynthCurrencyKeyUpdated');
      expect(events.length).toBe(2);
      expect(events[0]).toMatchEventArgs({
        synth: newSynth1,
        prevCurrencyKey: newSynth1CurrencyKey,
        nextCurrencyKey: altSynth1CurrencyKey,
      });
      expect(events[1]).toMatchEventArgs({
        synth: newSynth2,
        prevCurrencyKey: newSynth2CurrencyKey,
        nextCurrencyKey: altSynth2CurrencyKey,
      });
    */
    });
  });
});

describe('expected values', () => {
  it('returns the expected value from the valueInterpreter (18 decimals quote)', async () => {
    const valueInterpreter = fork.deployment.valueInterpreter;
    const sbtc = new StandardToken(fork.config.synthetix.synths.sbtc, provider);
    const dai = new StandardToken(fork.config.primitives.dai, provider);

    const baseDecimals = await sbtc.decimals();
    const quoteDecimals = await dai.decimals();

    expect(baseDecimals).toEqBigNumber(18);
    expect(quoteDecimals).toEqBigNumber(18);

    // sbtc/usd price at July 16, 2020 had a price of ca. $32500
    // Source: <https://www.coingecko.com/en/coins/sbtc/historical_data/usd?start_date=2021-07-16&end_date=2021-07-16#panel>

    const canonicalAssetValue = await valueInterpreter.calcCanonicalAssetValue
      .args(sbtc, utils.parseUnits('1', baseDecimals), dai)
      .call();

    expect(canonicalAssetValue).toEqBigNumber('31931382264446721234605');
  });

  it('returns the expected value from the valueInterpreter (non 18 decimals quote)', async () => {
    const valueInterpreter = fork.deployment.valueInterpreter;
    const sbtc = new StandardToken(fork.config.synthetix.synths.sbtc, provider);
    const usdc = new StandardToken(fork.config.primitives.usdc, provider);

    const baseDecimals = await sbtc.decimals();
    const quoteDecimals = await usdc.decimals();

    expect(baseDecimals).toEqBigNumber(18);
    expect(quoteDecimals).toEqBigNumber(6);

    // sbtc/usd price at July 16, 2020 had a price of $32500
    // Source: <https://www.coingecko.com/en/coins/sbtc/historical_data/usd?start_date=2021-07-16&end_date=2021-07-16#panel>

    const canonicalAssetValue = await valueInterpreter.calcCanonicalAssetValue
      .args(sbtc, utils.parseUnits('1', baseDecimals), usdc)
      .call();

    expect(canonicalAssetValue).toEqBigNumber('31934452377');
  });
});
