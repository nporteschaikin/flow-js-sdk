import {isTransaction} from "../interaction/interaction.js"
import {sansPrefix} from "@onflow/util-address"
import {
  encodeTransactionPayload as encodeInsideMessage,
  encodeTransactionEnvelope as encodeOutsideMessage,
} from "../encode/encode.js"

export async function resolveSignatures(ix) {
  if (isTransaction(ix)) {
    try {
      let insideSigners = findInsideSigners(ix)
      const insidePayload = encodeInsideMessage(prepForEncoding(ix))
      await Promise.all(insideSigners.map(fetchSignature(ix, insidePayload)))

      let outsideSigners = findOutsideSigners(ix)
      const outsidePayload = encodeOutsideMessage({
        ...prepForEncoding(ix),
        payloadSigs: insideSigners.map(id => ({
          address: ix.accounts[id].addr,
          keyId: ix.accounts[id].keyId,
          sig: ix.accounts[id].signature,
        })),
      })
      await Promise.all(outsideSigners.map(fetchSignature(ix, outsidePayload)))
    } catch (error) {
      console.error("Signatures", error, {ix})
      throw error
    }
  }
  return ix
}

function findInsideSigners(ix) {
  // Inside Signers Are: (authorizers + proposer) - payer
  let inside = new Set(ix.authorizations)
  inside.add(ix.proposer)
  inside.delete(ix.payer)
  return Array.from(inside)
}

function findOutsideSigners(ix) {
  // Outside Signers Are: (payer)
  let outside = new Set([ix.payer])
  return Array.from(outside)
}

function fetchSignature(ix, payload) {
  return async function innerFetchSignature(id) {
    const acct = ix.accounts[id]
    if (acct.signature != null) return
    const {signature} = await acct.signingFunction(
      buildSignable(acct, payload, ix)
    )
    // if (!acct.role.proposer) {
    //   ix.accounts[id].keyId = keyId
    // }
    ix.accounts[id].signature = signature
  }
}

function buildSignable(acct, message, ix) {
  try {
    return {
      f_type: "Signable",
      f_vsn: "1.0.0",
      message,
      addr: sansPrefix(acct.addr),
      keyId: acct.keyId,
      roles: acct.role,
      cadence: ix.message.cadence,
      args: ix.message.arguments.map(d => ix.arguments[d].asArgument),
      data: {},
      interaction: ix,
    }
  } catch (error) {
    console.error("buildSignable", error)
    throw error
  }
}

function prepForEncoding(ix) {
  return {
    script: ix.message.cadence,
    refBlock: ix.message.refBlock || null,
    gasLimit: ix.message.computeLimit,
    arguments: ix.message.arguments.map(id => ix.arguments[id].asArgument),
    proposalKey: {
      address: sansPrefix(ix.accounts[ix.proposer].addr),
      keyId: ix.accounts[ix.proposer].keyId,
      sequenceNum: ix.accounts[ix.proposer].sequenceNum,
    },
    payer: sansPrefix(ix.accounts[ix.payer].addr),
    authorizers: ix.authorizations
      .map(cid => sansPrefix(ix.accounts[cid].addr))
      .reduce((prev, current) => {
        return prev.find(item => item === current) ? prev : [...prev, current]
      }, []),
  }
}
