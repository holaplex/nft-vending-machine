import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Connection } from "@solana/web3.js";
import {
  findTransactionSignature,
  FindTransactionSignatureError,
  validateTransactionSignature,
} from "@solana/pay";

import { STATES } from "../lib/constants";
import { generateQRParams } from "../lib/qrparams";
import { getSigner } from "../lib/getsigner";

import PollForSignature from "../components/poll-for-signature/PollForSignature";
import LoadingScreen from "../components/loading-screen/LoadingScreen";
import ErrorScreen from "../components/error-screen/ErrorScreen";
import Header from "../components/header/Header";

import styles from "./index.module.scss";

export default function Home() {
  const router = useRouter();

  // QR code params
  const qrParams = generateQRParams();

  // solana connection
  const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL,
    "confirmed"
  );

  // vending machine mode
  let apiUrl;
  if (process.env.NEXT_PUBLIC_VENDING_MODE === "mint") {
    apiUrl = "api/mint";
  } else if (process.env.NEXT_PUBLIC_VENDING_MODE === "transfer") {
    apiUrl = "api/transfer";
  }

  // transaction state
  const [status, setStatus] = useState({
    state: STATES.POLL_FOR_SIGNATURE,
    data: null,
  });

  useEffect(() => {
    // navigate to success screen after mint
    if (status.state === STATES.NFT_MINT_SUCCESS) {
      router.push(`/success`);
    }
  }, [status, router]);

  useEffect(() => {
    let interval;
    let sigSetInterval;

    const findAndValidate = async () => {
      // poll for the transaction signature
      interval = setInterval(async () => {
        await findTransactionSignature(
          connection,
          qrParams.reference,
          undefined,
          "confirmed"
        )
          .then(async (signature) => {
            // signature found
            setStatus({ state: STATES.AWAIT_FOR_VALIDATION });
            clearInterval(interval);

            // validate the signature
            await validateTransactionSignature(
              connection,
              signature.signature,
              qrParams.recipient,
              qrParams.amount,
              undefined,
              qrParams.reference,
              "confirmed"
            )
              .then(async (validation) => {
                // signature validated, poll for the finalized transaction
                setStatus({ state: STATES.POLL_FOR_FINAL_TRANSACTION });

                sigSetInterval = setInterval(async () => {
                  await connection
                    .getParsedTransaction(validation.transaction.signatures[0])
                    .then((result) => {
                      // found final transaction
                      if (result) {
                        // stop polling for transaction
                        clearInterval(sigSetInterval);

                        // get transaction signer
                        const signer = getSigner(
                          result.transaction.message.accountKeys
                        );

                        setStatus({ state: STATES.AWAIT_FOR_NFT_MINT });

                        // mint or transfer the NFT
                        fetch(`${apiUrl}?signer=${signer}`)
                          .then((res) => {
                            if (res.ok) {
                              // success
                              setStatus({
                                state: STATES.NFT_MINT_SUCCESS,
                              });
                              console.log("mint success", res);
                            } else {
                              res.json().then((data) => {
                                setStatus({
                                  state: STATES.NFT_MINT_ERROR,
                                  data: data,
                                });
                                console.error("ERR: ", data);
                              });
                            }
                          })
                          .catch((err) => {
                            setStatus({
                              state: STATES.ERROR,
                              data: err,
                            });
                            console.error("Error: ", err);
                          });
                      }
                    })
                    .catch((err) => {
                      setStatus({
                        state: STATES.ERROR,
                        data: err,
                      });
                      console.error(err);

                      // stop polling for transaction
                      clearInterval(sigSetInterval);
                    });
                }, 5000);
              })
              .catch((err) => {
                setStatus({
                  state: STATES.ERROR,
                  data: err,
                });
                console.error("Unexpected Error:", err);
              });

            // stop polling
            clearInterval(interval);
          })
          .catch((err) => {
            // something unexpected went wrong, or the transaction wasn't found
            if (!(err instanceof FindTransactionSignatureError)) {
              // stop polling for signature
              clearInterval(interval);

              setStatus({
                state: STATES.ERROR,
                data: err,
              });

              console.log("Unexpected Error: ", err);
            }
          });
      }, 5000);

      return () => {
        clearInterval(interval);
        clearInterval(sigSetInterval);
        setStatus({ state: STATES.IDLE });
      };
    };

    // kick off finding and validating the signature + transaction
    findAndValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.container}>
      <Header />
      <main className={styles.main}>
        {(status.state === STATES.POLL_FOR_SIGNATURE && (
          <PollForSignature qrCodeParams={qrParams} />
        )) ||
          (status.state === STATES.AWAIT_FOR_VALIDATION && (
            <LoadingScreen
              title="Confirming Transaction"
              message={STATES.AWAIT_FOR_VALIDATION}
            />
          )) ||
          (status.state === STATES.POLL_FOR_FINAL_TRANSACTION && (
            <LoadingScreen
              title="Finishing Transaction"
              message={STATES.POLL_FOR_FINAL_TRANSACTION}
            />
          )) ||
          (status.state === STATES.AWAIT_FOR_NFT_MINT && (
            <LoadingScreen
              title="Minting NFT"
              message={STATES.AWAIT_FOR_NFT_MINT}
            />
          )) ||
          (status.state === STATES.NFT_MINT_ERROR && (
            <ErrorScreen message={STATES.NFT_MINT_ERROR} />
          )) ||
          (status.state === STATES.ERROR && (
            <ErrorScreen message={STATES.ERROR} />
          ))}
      </main>

      <footer className={styles.footer}></footer>
    </div>
  );
}
