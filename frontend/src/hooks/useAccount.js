import { useState, useEffect } from "react";
import web3 from "../utils/web3";

export function useAccount() {
    const [account, setAccount] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!window.ethereum) {
            setLoading(false);
            return;
        }

        const getAccount = async () => {
            try {
                const accounts = await web3.eth.getAccounts();
                setAccount(accounts.length > 0 ? accounts[0] : null);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        getAccount();

        // Listen for account changes in MetaMask
        const handleAccountsChanged = (accounts) => {
            setAccount(accounts.length > 0 ? accounts[0] : null);
        };
        window.ethereum.on("accountsChanged", handleAccountsChanged);

        return () => {
            window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
        };
    }, []);

    return { account, loading };
}