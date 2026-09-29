/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/settlement.json`.
 */
export type Settlement = {
  address: "6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z";
  metadata: {
    name: "settlement";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Turnstile settlement of signed payment authorizations";
  };
  instructions: [
    {
      name: "closeReceipt";
      docs: [
        "Closes a receipt and returns its rent to the fee payer that paid it. Allowed only once",
        "`RECEIPT_RETENTION_SECONDS` have passed since the authorization expired. `settle` refuses",
        "an expired authorization before it looks at the receipt, so a closed receipt never lets",
        "its nonce settle again.",
      ];
      discriminator: [126, 254, 244, 203, 124, 164, 134, 89];
      accounts: [
        {
          name: "receipt";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 99, 101, 105, 112, 116];
              },
              {
                kind: "account";
                path: "receipt.agentWallet";
                account: "receipt";
              },
              {
                kind: "account";
                path: "receipt.nonce";
                account: "receipt";
              },
            ];
          };
        },
        {
          name: "feePayer";
          docs: ["The fee payer that paid the receipt rent. It signs and receives the lamports."];
          writable: true;
          signer: true;
          relations: ["receipt"];
        },
      ];
      args: [];
    },
    {
      name: "settle";
      discriminator: [175, 42, 185, 87, 144, 131, 102, 212];
      accounts: [
        {
          name: "feePayer";
          docs: ["Pays the transaction fee and the receipt rent. Has no authority over any funds."];
          writable: true;
          signer: true;
        },
        {
          name: "settlementAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "agentWallet";
          writable: true;
        },
        {
          name: "vault";
          writable: true;
        },
        {
          name: "recipientToken";
          writable: true;
        },
        {
          name: "receipt";
          docs: ["creates it otherwise."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 99, 101, 105, 112, 116];
              },
              {
                kind: "arg";
                path: "authorization.agentWallet";
              },
              {
                kind: "arg";
                path: "authorization.nonce";
              },
            ];
          };
        },
        {
          name: "instructions";
          address: "Sysvar1nstructions1111111111111111111111111";
        },
        {
          name: "agentWalletProgram";
          address: "7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "authorization";
          type: {
            defined: {
              name: "paymentAuthorization";
            };
          };
        },
      ];
    },
    {
      name: "verifyReceipt";
      docs: [
        "Read only check that the receipt for `authorization` exists and records exactly that",
        "payment. Fails with `AccountMismatch` when any field differs. Meant for simulation by a",
        "facilitator that wants the chain to confirm an earlier settlement.",
      ];
      discriminator: [202, 144, 21, 149, 181, 189, 23, 170];
      accounts: [
        {
          name: "receipt";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 101, 99, 101, 105, 112, 116];
              },
              {
                kind: "arg";
                path: "authorization.agentWallet";
              },
              {
                kind: "arg";
                path: "authorization.nonce";
              },
            ];
          };
        },
      ];
      args: [
        {
          name: "authorization";
          type: {
            defined: {
              name: "paymentAuthorization";
            };
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: "receipt";
      discriminator: [39, 154, 73, 106, 80, 102, 145, 153];
    },
  ];
  events: [
    {
      name: "paymentSettled";
      discriminator: [158, 182, 152, 76, 105, 23, 232, 135];
    },
  ];
  errors: [
    {
      code: 6100;
      name: "authorizationExpired";
      msg: "The payment authorization has expired. Ask the agent to sign a fresh one";
    },
    {
      code: 6101;
      name: "missingSignatureVerification";
      msg: "The instruction before settle must be an Ed25519 signature check. Add it with ed25519VerifyInstruction";
    },
    {
      code: 6102;
      name: "signatureMismatch";
      msg: "The Ed25519 check does not cover this authorization with its session key. Sign the exact authorization message";
    },
    {
      code: 6103;
      name: "nonceAlreadyUsed";
      msg: "This nonce has already settled. Use a new nonce for a new payment";
    },
    {
      code: 6104;
      name: "accountMismatch";
      msg: "An account does not match the authorization. Pass the wallet, vault, mint and recipient it names";
    },
    {
      code: 6105;
      name: "retentionNotElapsed";
      msg: "This receipt is still inside its retention period. Close it after 7 days past the authorization expiry";
    },
    {
      code: 6106;
      name: "notFeePayer";
      msg: "Only the fee payer that paid for this receipt can close it. Sign with that key";
    },
  ];
  types: [
    {
      name: "agentWallet";
      type: {
        kind: "struct";
        fields: [
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "id";
            type: "u64";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "vault";
            type: "pubkey";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "vaultBump";
            type: "u8";
          },
          {
            name: "createdAt";
            type: "i64";
          },
          {
            name: "perCallCap";
            type: "u64";
          },
          {
            name: "dailyCap";
            type: "u64";
          },
          {
            name: "sessionKeys";
            type: {
              vec: {
                defined: {
                  name: "sessionKey";
                };
              };
            };
          },
          {
            name: "allowList";
            type: {
              vec: {
                defined: {
                  name: "allowListEntry";
                };
              };
            };
          },
          {
            name: "spendBuckets";
            docs: ["Ring of 97 buckets. The slot for bucket index `i` is `i mod 97`."];
            type: {
              vec: {
                defined: {
                  name: "spendBucket";
                };
              };
            };
          },
          {
            name: "totalSpent";
            type: "u64";
          },
          {
            name: "settlementCount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "allowListEntry";
      type: {
        kind: "struct";
        fields: [
          {
            name: "resourceId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "recipient";
            docs: ["Owner of the recipient token account."];
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "paymentAuthorization";
      docs: [
        "A payment the agent's session key agreed to. Borsh layout is the 208 byte body of the",
        "signed message and matches `encodeAuthorizationBody` in packages/shared.",
      ];
      type: {
        kind: "struct";
        fields: [
          {
            name: "agentWallet";
            type: "pubkey";
          },
          {
            name: "sessionKey";
            type: "pubkey";
          },
          {
            name: "recipient";
            docs: ["Owner of the recipient token account."];
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "amount";
            docs: ["Base units of the mint."];
            type: "u64";
          },
          {
            name: "resourceId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "nonce";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "expiresAt";
            docs: ["Unix seconds."];
            type: "i64";
          },
        ];
      };
    },
    {
      name: "paymentSettled";
      docs: [
        "Emitted with `emit!` so it lands in the program logs as `Program data: <base64>`.",
        "Carries every receipt field plus the receipt address.",
      ];
      type: {
        kind: "struct";
        fields: [
          {
            name: "receipt";
            type: "pubkey";
          },
          {
            name: "agentWallet";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "sessionKey";
            type: "pubkey";
          },
          {
            name: "recipient";
            type: "pubkey";
          },
          {
            name: "recipientToken";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "amount";
            type: "u64";
          },
          {
            name: "resourceId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "nonce";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "slot";
            type: "u64";
          },
          {
            name: "unixTimestamp";
            type: "i64";
          },
          {
            name: "feePayer";
            type: "pubkey";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "expiresAt";
            docs: [
              "`expires_at` of the settled authorization. `close_receipt` waits until",
              "`RECEIPT_RETENTION_SECONDS` after it.",
            ];
            type: "i64";
          },
        ];
      };
    },
    {
      name: "receipt";
      type: {
        kind: "struct";
        fields: [
          {
            name: "agentWallet";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "sessionKey";
            type: "pubkey";
          },
          {
            name: "recipient";
            type: "pubkey";
          },
          {
            name: "recipientToken";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "amount";
            type: "u64";
          },
          {
            name: "resourceId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "nonce";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "slot";
            type: "u64";
          },
          {
            name: "unixTimestamp";
            type: "i64";
          },
          {
            name: "feePayer";
            type: "pubkey";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "expiresAt";
            docs: [
              "`expires_at` of the settled authorization. `close_receipt` waits until",
              "`RECEIPT_RETENTION_SECONDS` after it.",
            ];
            type: "i64";
          },
        ];
      };
    },
    {
      name: "sessionKey";
      type: {
        kind: "struct";
        fields: [
          {
            name: "key";
            type: "pubkey";
          },
          {
            name: "expiresAt";
            docs: ["Unix seconds. 0 means no expiry."];
            type: "i64";
          },
          {
            name: "active";
            type: "bool";
          },
        ];
      };
    },
    {
      name: "spendBucket";
      type: {
        kind: "struct";
        fields: [
          {
            name: "index";
            docs: ["`floor(unix_timestamp / 900)`."];
            type: "i64";
          },
          {
            name: "amount";
            type: "u64";
          },
        ];
      };
    },
  ];
  constants: [
    {
      name: "authorizationDomain";
      docs: ["Domain prefix of every signed authorization. Exactly 20 ASCII bytes."];
      type: "bytes";
      value: "[84, 85, 82, 78, 83, 84, 73, 76, 69, 95, 80, 65, 89, 77, 69, 78, 84, 95, 86, 49]";
    },
    {
      name: "receiptRetentionSeconds";
      docs: [
        "How long a receipt stays on chain after its authorization expires before the fee payer may",
        "close it and take the rent back. Seven days.",
      ];
      type: "i64";
      value: "604800";
    },
    {
      name: "seedReceipt";
      type: "bytes";
      value: "[114, 101, 99, 101, 105, 112, 116]";
    },
    {
      name: "seedSettlementAuthority";
      type: "bytes";
      value: "[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]";
    },
  ];
};
