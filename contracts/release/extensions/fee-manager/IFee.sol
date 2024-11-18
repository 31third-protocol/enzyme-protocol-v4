// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Enzyme Protocol.

    (c) Enzyme Foundation <security@enzyme.finance>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity >=0.6.0 <0.9.0;

import {IFeeManager} from "./IFeeManager.sol";

/// @title Fee Interface
/// @author Enzyme Foundation <security@enzyme.finance>
/// @notice Interface for all fees
interface IFee {
    function activateForFund(address _comptrollerProxy, address _vaultProxy) external;

    function addFundSettings(address _comptrollerProxy, bytes calldata _settingsData) external;

    function getRecipientForFund(address _comptrollerProxy) external view returns (address recipient_);

    function settle(
        address _comptrollerProxy,
        address _vaultProxy,
        IFeeManager.FeeHook _hook,
        bytes calldata _settlementData,
        uint256 _gav
    ) external returns (IFeeManager.SettlementType settlementType_, address payer_, uint256 sharesDue_);

    function settlesOnHook(IFeeManager.FeeHook _hook) external view returns (bool settles_, bool usesGav_);

    function update(
        address _comptrollerProxy,
        address _vaultProxy,
        IFeeManager.FeeHook _hook,
        bytes calldata _settlementData,
        uint256 _gav
    ) external;

    function updatesOnHook(IFeeManager.FeeHook _hook) external view returns (bool updates_, bool usesGav_);

    /// @dev This is legacy and no longer serves a purpose. Can be removed once fees are not meant to be backwards-compatible.
    function payout(address _comptrollerProxy, address _vaultProxy) external returns (bool isPayable_);
}
