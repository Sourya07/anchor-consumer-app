import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { A } from "../target/types/a";
import { assert } from "chai";

describe("sovereign_ai", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.a as Program<A>;
  const provider = anchor.getProvider();
  
  // Create an explicit keypair for the user
  const user = anchor.web3.Keypair.generate();

  it("Is initialized!", async () => {
    // Airdrop SOL to the user
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      "confirmed"
    );

    const [pda, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sovereign_ai"), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize()
      .accounts({
        user: user.publicKey,
        pda: pda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Fetch the account and check its state
    const account = await program.account.aiState.fetch(pda);
    assert.ok(account.user.equals(user.publicKey));
    assert.ok(account.stateRoot.every(val => val === 0));
    assert.equal(account.bump, bump);
  });

  it("Updates state!", async () => {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sovereign_ai"), user.publicKey.toBuffer()],
      program.programId
    );

    // Some dummy 32-byte hash (representing a Merkle root)
    const newRoot = Array.from({length: 32}, (_, i) => i + 1);

    await program.methods
      .updateState(newRoot)
      .accounts({
        user: user.publicKey,
        pda: pda,
      })
      .signers([user])
      .rpc();

    // Fetch the account and verify the new state
    const account = await program.account.aiState.fetch(pda);
    assert.deepEqual(account.stateRoot, newRoot);
  });
});
