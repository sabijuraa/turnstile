/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/agent_wallet.json`.
 */
export type AgentWallet = {
  address: "7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb";
  metadata: {
    name: "agentWallet";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Turnstile agent wallet with an on-chain spending policy";
  };
  instructions: [
    {
      name: "addSessionKey";
      docs: [
        "Adds a session key. A full list reuses the first slot held by a revoked or expired key.",
      ];
      discriminator: [48, 71, 165, 97, 37, 22, 181, 59];
      accounts: [
        {
          name: "owner";
          signer: true;
          relations: ["agentWallet"];
        },
        {
          name: "agentWallet";
          writable: true;
        },
      ];
      args: [
        {
          name: "key";
          type: "pubkey";
        },
        {
          name: "expiresAt";
          type: "i64";
        },
      ];
    },
    {
      name: "closeWallet";
      docs: ["Closes an empty vault and the wallet. Rent from both goes back to the owner."];
      discriminator: [35, 212, 234, 224, 244, 208, 31, 204];
      accounts: [
        {
          name: "owner";
          writable: true;
          signer: true;
          relations: ["agentWallet"];
        },
        {
          name: "agentWallet";
          writable: true;
        },
        {
          name: "vault";
          writable: true;
          relations: ["agentWallet"];
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [];
    },
    {
      name: "createWallet";
      docs: [
        "Creates the agent wallet PDA and its vault for `mint`, with one session key and caps.",
        "The allow-list starts empty, which allows nothing until the owner sets it.",
      ];
      discriminator: [82, 172, 128, 18, 161, 207, 88, 63];
      accounts: [
        {
          name: "owner";
          writable: true;
          signer: true;
        },
        {
          name: "agentWallet";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [97, 103, 101, 110, 116, 95, 119, 97, 108, 108, 101, 116];
              },
              {
                kind: "account";
                path: "owner";
              },
              {
                kind: "arg";
                path: "id";
              },
            ];
          };
        },
        {
          name: "mint";
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "agentWallet";
              },
            ];
          };
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
          name: "id";
          type: "u64";
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
          name: "sessionKey";
          type: "pubkey";
        },
        {
          name: "sessionExpiresAt";
          type: "i64";
        },
      ];
    },
    {
      name: "debit";
      docs: [
        "Pays `amount` from the vault to `recipient_token` after the full policy check.",
        "Callable only through CPI signed by the settlement program's `settlement_authority`.",
      ];
      discriminator: [144, 252, 105, 115, 174, 111, 100, 65];
      accounts: [
        {
          name: "settlementAuthority";
          docs: ["Any other caller gets `UnauthorizedCaller`."];
          signer: true;
          address: "AchLyVbEk5nXx2K73LB43wvBCqY4V4xyei9bTwSrS5Tz";
        },
        {
          name: "agentWallet";
          writable: true;
        },
        {
          name: "vault";
          writable: true;
          relations: ["agentWallet"];
        },
        {
          name: "recipientToken";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "sessionKey";
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
      ];
    },
    {
      name: "deposit";
      docs: ["Moves `amount` from an owner token account into the vault."];
      discriminator: [242, 35, 198, 137, 82, 225, 242, 182];
      accounts: [
        {
          name: "owner";
          signer: true;
          relations: ["agentWallet"];
        },
        {
          name: "agentWallet";
        },
        {
          name: "vault";
          writable: true;
          relations: ["agentWallet"];
        },
        {
          name: "ownerToken";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "revokeSessionKey";
      docs: [
        "Revokes a session key. A revoked key cannot authorize a payment while it stays revoked.",
        "Re-adding the same key later revives any of its unexpired, unsettled authorizations, so rotate",
        "to a new key instead.",
      ];
      discriminator: [81, 192, 32, 110, 104, 116, 144, 151];
      accounts: [
        {
          name: "owner";
          signer: true;
          relations: ["agentWallet"];
        },
        {
          name: "agentWallet";
          writable: true;
        },
      ];
      args: [
        {
          name: "key";
          type: "pubkey";
        },
      ];
    },
    {
      name: "rollingSpend";
      docs: ["Returns the spend that counts toward the daily cap right now, as u64 return data."];
      discriminator: [245, 14, 199, 168, 40, 216, 170, 67];
      accounts: [
        {
          name: "agentWallet";
        },
      ];
      args: [];
      returns: "u64";
    },
    {
      name: "updatePolicy";
      docs: ["Replaces the caps and the allow-list in one step."];
      discriminator: [212, 245, 246, 7, 163, 151, 18, 57];
      accounts: [
        {
          name: "owner";
          signer: true;
          relations: ["agentWallet"];
        },
        {
          name: "agentWallet";
          writable: true;
        },
      ];
      args: [
        {
          name: "perCallCap";
          type: "u64";
        },
        {
          name: "dailyCap";
          type: "u64";
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
      ];
    },
    {
      name: "withdraw";
      docs: ["Moves `amount` from the vault to a token account the owner holds."];
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34];
      accounts: [
        {
          name: "owner";
          signer: true;
          relations: ["agentWallet"];
        },
        {
          name: "agentWallet";
        },
        {
          name: "vault";
          writable: true;
          relations: ["agentWallet"];
        },
        {
          name: "ownerToken";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
  ];
  accounts: [
    {
      name: "agentWallet";
      discriminator: [127, 35, 180, 143, 201, 1, 100, 50];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "sessionKeyNotFound";
      msg: "This session key is not registered on the agent wallet. Add it with add_session_key first";
    },
    {
      code: 6001;
      name: "sessionKeyRevoked";
      msg: "This session key was revoked. Sign with an active session key";
    },
    {
      code: 6002;
      name: "sessionKeyExpired";
      msg: "This session key has expired. Ask the owner to add a new session key";
    },
    {
      code: 6003;
      name: "perCallCapExceeded";
      msg: "The amount is above the per-call cap. Pay less or ask the owner to raise the cap";
    },
    {
      code: 6004;
      name: "dailyCapExceeded";
      msg: "The payment would take the last 24 hours above the daily cap. Wait for older spend to age out or raise the cap";
    },
    {
      code: 6005;
      name: "resourceNotAllowed";
      msg: "This resource and recipient pair is not on the allow-list. Ask the owner to add it";
    },
    {
      code: 6006;
      name: "unauthorizedCaller";
      msg: "The caller is not allowed to run this instruction. Use the wallet owner or the settlement program";
    },
    {
      code: 6007;
      name: "insufficientFunds";
      msg: "The vault does not hold enough tokens. Deposit more before paying or withdrawing";
    },
    {
      code: 6008;
      name: "zeroAmount";
      msg: "The amount must be above zero";
    },
    {
      code: 6009;
      name: "invalidPolicy";
      msg: "The per-call cap must not exceed the daily cap and expiry times must not be negative";
    },
    {
      code: 6010;
      name: "tooManySessionKeys";
      msg: "The wallet already holds 4 usable session keys. Revoke one before adding another";
    },
    {
      code: 6011;
      name: "allowListTooLong";
      msg: "The allow-list can hold at most 16 entries";
    },
    {
      code: 6012;
      name: "duplicateSessionKey";
      msg: "This session key is already on the wallet";
    },
    {
      code: 6013;
      name: "vaultNotEmpty";
      msg: "The vault still holds tokens. Withdraw everything before closing the wallet";
    },
    {
      code: 6014;
      name: "mintMismatch";
      msg: "The token account uses a different mint than the agent wallet";
    },
    {
      code: 6015;
      name: "recipientMismatch";
      msg: "The destination token account belongs to the wrong owner";
    },
    {
      code: 6016;
      name: "accountMismatch";
      msg: "An account does not match the agent wallet. Pass the wallet's own vault";
    },
    {
      code: 6017;
      name: "arithmeticOverflow";
      msg: "A counter would overflow. The wallet cannot record this payment";
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
      name: "seedAgentWallet";
      type: "bytes";
      value: "[97, 103, 101, 110, 116, 95, 119, 97, 108, 108, 101, 116]";
    },
    {
      name: "seedSettlementAuthority";
      type: "bytes";
      value: "[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]";
    },
    {
      name: "seedVault";
      type: "bytes";
      value: "[118, 97, 117, 108, 116]";
    },
  ];
};
