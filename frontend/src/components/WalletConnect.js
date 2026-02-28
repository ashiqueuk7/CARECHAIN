import { useEffect, useState } from "react";
import web3 from "../utils/web3";

function WalletConnect() {
  const [account, setAccount] = useState("");

  useEffect(() => {
    const load = async () => {
      const accounts = await web3.eth.getAccounts();
      if (accounts.length > 0) {
        setAccount(accounts[0]);
      }
    };
    load();
  }, []);

  const connectWallet = async () => {
    const accounts = await web3.eth.requestAccounts();
    setAccount(accounts[0]);
  };

  return (
    <div className="text-end p-3">
      {account ? (
        <span className="text-info">
          Connected: {account.substring(0, 6)}...
        </span>
      ) : (
        <button className="btn btn-medical" onClick={connectWallet}>
          Connect Wallet
        </button>
      )}
    </div>
  );
}

export default WalletConnect;