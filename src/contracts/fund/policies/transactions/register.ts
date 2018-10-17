import { Address } from '~/utils/types';
import { getFunctionSignature } from '~/utils/abi';
import { prepareTransaction, sendTransaction } from '~/utils/solidity';
import { getGenericExchangeInterfaceABI } from '~/contracts/exchanges';
import { getPolicyManagerContract } from '../utils/getPolicyManagerContract';

const genericExchangeInterfaceABI = getGenericExchangeInterfaceABI();

export enum PolicedMethods {
  makeOrder = getFunctionSignature(genericExchangeInterfaceABI, 'makeOrder'),
  takeOrder = getFunctionSignature(genericExchangeInterfaceABI, 'takeOrder'),
  // TODO: Add more here
  // tslint:disable-next-line:max-line-length
  // executeRequest = getFunctionSignature(genericExchangeInterfaceABI, 'takeOrder'),
}

interface RegisterArgs {
  method: PolicedMethods;
  policy: Address;
}

export const guards = async (contractAddress: Address, environment) => {
  // TODO
};

export const prepare = async (
  contractAddress: Address,
  { method, policy },
  environment,
) => {
  const contract = getPolicyManagerContract(contractAddress);
  const transaction = contract.methods.register(method, policy.toString());
  transaction.name = 'register';
  const prepared = await prepareTransaction(transaction, environment);
  return prepared;
};

export const validateReceipt = receipt => {
  return true;
};

export const register = async (
  contractAddress: Address,
  { method, policy }: RegisterArgs,
  environment?,
) => {
  await guards(contractAddress, environment);
  const transaction = await prepare(
    contractAddress,
    { method, policy },
    environment,
  );
  const receipt = await sendTransaction(transaction, environment);
  const result = validateReceipt(receipt);
  return result;
};