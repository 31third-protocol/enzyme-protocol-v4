pragma solidity 0.6.1;
pragma experimental ABIEncoderV2;

import "./ExchangeAdapter.sol";
import "./interfaces/IZeroExV3.sol";
import "./OrderFiller.sol";

/// @title ZeroExV3Adapter Contract
/// @author Melonport AG <team@melonport.com>
/// @notice Adapter to 0xV3 Exchange Contract
contract ZeroExV3Adapter is ExchangeAdapter, OrderFiller {
    /// @notice Takes an active order on 0x v3
    /// @param _orderAddresses [0] Order param: makerAddress
    /// @param _orderAddresses [1] Order param: takerAddress
    /// @param _orderAddresses [2] Maker asset
    /// @param _orderAddresses [3] Taker asset
    /// @param _orderAddresses [4] Order param: feeRecipientAddress
    /// @param _orderAddresses [5] Order param: senderAddress
    /// @param _orderAddresses [6] Maker fee asset
    /// @param _orderAddresses [7] Taker fee asset
    /// @param _orderData [0] Order param: makerAssetData
    /// @param _orderData [1] Order param: takerAssetData
    /// @param _orderData [2] Order param: makerFeeAssetData
    /// @param _orderData [3] Order param: takerFeeAssetData
    /// @param _orderValues [0] Order param: makerAssetAmount
    /// @param _orderValues [1] Order param: takerAssetAmount
    /// @param _orderValues [2] Order param: makerFee
    /// @param _orderValues [3] Order param: takerFee
    /// @param _orderValues [4] Order param: expirationTimeSeconds
    /// @param _orderValues [5] Order param: salt
    /// @param _orderValues [6] Taker asset fill quantity
    /// @param _identifier Order identifier
    /// @param _signature Signature of the order
    function takeOrder(
        address _targetExchange,
        address[8] memory _orderAddresses,
        uint[8] memory _orderValues,
        bytes[4] memory _orderData,
        bytes32 _identifier,
        bytes memory _signature
    )
        public
        override
    {
        validateTakeOrderParams(
            _targetExchange,
            _orderAddresses,
            _orderValues,
            _orderData,
            _signature
        );

        (
            address[] memory fillAssets,
            uint256[] memory fillExpectedAmounts
        ) = formatFillTakeOrderArgs(
            _targetExchange,
            _orderAddresses,
            _orderValues
        );

        fillTakeOrder(
            _targetExchange,
            fillAssets,
            fillExpectedAmounts,
            constructOrderStruct(_orderAddresses, _orderValues, _orderData),
            _signature
        );
    }

    // INTERNAL METHODS

    // Approves takerAsset, takerFeeAsset, protocolFee
    function approveAssetsTakeOrder(
        address _targetExchange,
        IZeroExV3.Order memory _order,
        uint256[] memory _fillExpectedAmounts
    )
        internal
    {
        approveProtocolFeeAsset(_targetExchange);
        uint256 takerFeeAmount = mul(_order.takerFee, _fillTakerAmount) / _order.takerAssetAmount;
        approveAsset(
            getAssetAddress(_order.takerAssetData),
            getAssetProxy(_targetExchange, _order.takerAssetData),
            _fillExpectedAmounts[1],
            "takerAsset"
        );
        if (takerFeeAmount > 0) {
            approveAsset(
                getAssetAddress(_order.takerFeeAssetData),
                getAssetProxy(_targetExchange, _order.takerFeeAssetData),
                _fillExpectedAmounts[3],
                "takerFeeAsset"
            );
        }
    }

    function approveProtocolFeeAsset(address _targetExchange) internal {
        address protocolFeeCollector = IZeroExV3(_targetExchange).protocolFeeCollector();
        uint256 protocolFeeAmount = calcProtocolFeeAmount(_targetExchange);
        if (protocolFeeCollector == address(0) || protocolFeeAmount == 0) return;

        approveAsset(
            getNativeAssetAddress(),
            protocolFeeCollector,
            protocolFeeAmount,
            "protocolFee"
        );
    }

    function calcProtocolFeeAmount(address _targetExchange) internal view returns (uint256) {
        return mul(IZeroExV3(_targetExchange).protocolFeeMultiplier(), tx.gasprice);
    }

    function constructOrderStruct(
        address[8] memory _orderAddresses,
        uint[8] memory _orderValues,
        bytes[4] memory _orderData
    )
        internal
        pure
        returns (IZeroExV3.Order memory order_)
    {
        order_ = IZeroExV3.Order({
            makerAddress: _orderAddresses[0],
            takerAddress: _orderAddresses[1],
            feeRecipientAddress: _orderAddresses[4],
            senderAddress: _orderAddresses[5],
            makerAssetAmount: _orderValues[0],
            takerAssetAmount: _orderValues[1],
            makerFee: _orderValues[2],
            takerFee: _orderValues[3],
            expirationTimeSeconds: _orderValues[4],
            salt: _orderValues[5],
            makerAssetData: _orderData[0],
            takerAssetData: _orderData[1],
            makerFeeAssetData: _orderData[2],
            takerFeeAssetData: _orderData[3]
        });
    }

    function fillTakeOrder(
        address _targetExchange,
        address[] memory _fillAssets,
        uint256[] memory _fillExpectedAmounts,
        IZeroExV3.Order memory _order,
        bytes memory _signature
    )
        internal
        validateAndFinalizeFilledOrder(
            _targetExchange,
            _fillAssets,
            _fillExpectedAmounts
        )
    {
        // Approve taker and taker fee assets
        approveAssetsTakeOrder(_targetExchange, _order, _fillExpectedAmounts);

        // Execute take order on exchange
        IZeroExV3(_targetExchange).fillOrder(_order, _fillExpectedAmounts[1], _signature);
    }

    function formatFillTakeOrderArgs(
        address _targetExchange,
        address[8] memory _orderAddresses,
        uint256[8] memory _orderValues
    )
        internal
        view
        returns (address[] memory, uint256[] memory)
    {
        address[] memory fillAssets = new address[](4);
        fillAssets[0] = _orderAddresses[2]; // maker asset
        fillAssets[1] = _orderAddresses[3]; // taker asset
        fillAssets[2] = getNativeAssetAddress(); // protocol fee
        fillAssets[3] = _orderAddresses[7]; // taker fee asset

        uint256[] memory fillExpectedAmounts = new uint256[](4);
        fillExpectedAmounts[0] = calculateExpectedFillAmount(
            _orderValues[1],
            _orderValues[0],
            _orderValues[6]
        ); // maker fill amount; calculated relative to taker fill amount
        fillExpectedAmounts[1] = _orderValues[6]; // taker fill amount
        fillExpectedAmounts[2] = calcProtocolFeeAmount(_targetExchange); // protocol fee
        fillExpectedAmounts[3] = calculateExpectedFillAmount(
            _orderValues[1],
            _orderValues[3],
            _orderValues[6]
        ); // taker fee amount; calculated relative to taker fill amount

        return (fillAssets, fillExpectedAmounts);
    }

    function getAssetProxy(address _targetExchange, bytes memory _assetData)
        internal
        view
        returns (address assetProxy_)
    {
        bytes4 assetProxyId;
        assembly {
            assetProxyId := and(mload(
                add(_assetData, 32)),
                0xFFFFFFFF00000000000000000000000000000000000000000000000000000000
            )
        }
        assetProxy_ = IZeroExV3(_targetExchange).getAssetProxy(assetProxyId);
    }

    function getAssetAddress(bytes memory _assetData)
        internal
        pure
        returns (address assetAddress_)
    {
        assembly {
            assetAddress_ := mload(add(_assetData, 36))
        }
    }

    function validateTakeOrderParams(
        address _targetExchange,
        address[8] memory _orderAddresses,
        uint256[8] memory _orderValues,
        bytes[4] memory _orderData,
        bytes memory _signature
    )
        internal
        view
    {
        require(
            getAssetAddress(_orderData[0]) == _orderAddresses[2],
            "validateTakeOrderParams: makerAssetData does not match address"
        );
        require(
            getAssetAddress(_orderData[1]) == _orderAddresses[3],
            "validateTakeOrderParams: takerAssetData does not match address"
        );
        require(
            calculateExpectedFillAmount(
                _orderValues[1],
                _orderValues[0],
                _orderValues[6]
            ) <= _orderValues[0],
            "validateTakeOrderParams: Maker fill amount greater than max order quantity"
        );
        if (_orderValues[2] > 0) {
            require(
                getAssetAddress(_orderData[2]) == _orderAddresses[6],
                "validateTakeOrderParams: makerFeeAssetData does not match address"
            );
        }
        if (_orderValues[3] > 0) {
            require(
                getAssetAddress(_orderData[3]) == _orderAddresses[7],
                "validateTakeOrderParams: takerFeeAssetData does not match address"
            );
        }
        require(
            IZeroExV3(_targetExchange).isValidOrderSignature(
                constructOrderStruct(_orderAddresses, _orderValues, _orderData),
                _signature
            ),
            "validateTakeOrderParams: order signature is invalid"
        );
    }
}