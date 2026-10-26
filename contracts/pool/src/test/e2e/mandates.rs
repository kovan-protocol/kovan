//! Tests execute the real account WASM and Ed25519 verifier. Payment auth is never mocked.
use super::*;
use kovan_covenant_types::PaymentTerms;

#[test]
fn bare_token_transfer_cannot_bypass_mandates() {
    let s = signed_setup();
    let e = &s.fx.e;
    let inv = contract_fn(&s.fx.usdc, "transfer", std::vec![to_scval(e, s.agent.clone()), to_scval(e, s.fx.prov.clone()), to_scval(e, 1i128)]);
    e.set_auths(&[signed_entry(e, &s.agent, &s.signer, &s.key, inv)]);
    assert!(token::TokenClient::new(e, &s.fx.usdc).try_transfer(&s.agent, &s.fx.prov, &1).is_err());
    assert_eq!(bal(&s.fx, &s.fx.prov), 0);
}

#[test]
fn payment_receipt_and_counters_commit_with_transfer() {
    let s = signed_setup();
    assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_ok());
    let payment = binding(&s.fx.e, 3);
    let state = s.fx.pool.get_mandate(&s.agent, &payment.mandate_id).first().unwrap();
    assert_eq!(state.spent, 1_000_000);
    assert_eq!(state.payments, 1);
    let receipt = s.fx.pool.get_payment(&s.agent, &payment.payment_id).first().unwrap();
    assert_eq!(receipt.terms.amount, 1_000_000);
    assert_eq!(receipt.terms.reference, payment.reference);
    assert_eq!(receipt.terms.payee, s.fx.prov);
}

#[test]
fn same_payment_id_with_fresh_host_nonce_is_refused() {
    let s = signed_setup();
    assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_ok());
    assert!(transfer_bound(&s, &s.fx.prov, 1_000_000, 2, binding(&s.fx.e, 3)).is_err());
    assert_eq!(bal(&s.fx, &s.fx.prov), 1_000_000);
    assert_eq!(s.fx.pool.get_mandate(&s.agent, &binding(&s.fx.e, 3).mandate_id).first().unwrap().spent, 1_000_000);
}

#[test]
fn same_payment_id_cannot_move_to_another_mandate() {
    let s = signed_setup();
    let mut params = s.fx.pool.get_mandate(&s.agent, &binding(&s.fx.e, 3).mandate_id).first().unwrap().params;
    params.id = BytesN::from_array(&s.fx.e, &[9; 32]);
    s.fx.pool.create_mandate(&s.agent, &params);
    assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_ok());
    let mut payment = binding(&s.fx.e, 3);
    payment.mandate_id = params.id;
    assert!(transfer_bound(&s, &s.fx.prov, 1_000_000, 2, payment).is_err());
}

#[test]
fn different_payments_accumulate_and_mandate_budget_is_enforced() {
    let s = signed_setup();
    let mut params = s.fx.pool.get_mandate(&s.agent, &binding(&s.fx.e, 3).mandate_id).first().unwrap().params;
    params.id = BytesN::from_array(&s.fx.e, &[9; 32]);
    if let MandateScope::Budget(ref mut b) = params.scope { b.total_cap = 2_500_000; }
    s.fx.pool.create_mandate(&s.agent, &params);
    let mut a = binding(&s.fx.e, 10); a.mandate_id = params.id.clone();
    let mut b = binding(&s.fx.e, 11); b.mandate_id = params.id.clone();
    assert!(transfer_bound(&s, &s.fx.prov, 2_000_000, 1, a).is_ok());
    assert!(transfer_bound(&s, &s.fx.prov, 1_000_000, 2, b.clone()).is_err());
    assert!(s.fx.pool.get_payment(&s.agent, &b.payment_id).is_empty());
    assert_eq!(s.fx.pool.get_mandate(&s.agent, &params.id).first().unwrap().spent, 2_000_000);
}

#[test]
fn failed_token_transfer_does_not_consume_payment_or_budget() {
    let s = signed_setup();
    s.fx.pool.return_funds(&s.agent, &s.fx.owner, &LIMIT);
    assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_err());
    assert!(s.fx.pool.get_payment(&s.agent, &binding(&s.fx.e, 3).payment_id).is_empty());
    assert_eq!(s.fx.pool.get_mandate(&s.agent, &binding(&s.fx.e, 3).mandate_id).first().unwrap().spent, 0);
    assert_eq!(CovenantPolicyContractClient::new(&s.fx.e, &s.fx.policy).get_covenant(&s.agent).provider_spent, 0);
    s.fx.e.mock_all_auths();
    s.fx.pool.draw(&s.agent, &LIMIT);
    assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_ok());
}

#[test]
fn revoked_mandate_blocks_previously_signed_payment_but_recovery_works() {
    let s = signed_setup();
    let e = &s.fx.e;
    let entry = payment_entry(&s, &s.fx.prov, 1_000_000, 1, binding(e, 3));
    s.fx.pool.revoke_mandate(&s.agent, &binding(e, 3).mandate_id);
    e.set_auths(&[entry]);
    assert!(token::TokenClient::new(e, &s.fx.usdc).try_transfer(&s.agent, &s.fx.prov, &1_000_000).is_err());
    e.set_auths(&[pool_call_with_signature(&s, 2, "return_funds", std::vec![to_scval(e, s.agent.clone()), to_scval(e, s.agent.clone()), to_scval(e, LIMIT)])]);
    s.fx.pool.return_funds(&s.agent, &s.agent, &LIMIT);
    assert_eq!(bal(&s.fx, &s.agent), 0);
}

#[test]
fn missing_mandate_or_expired_payment_is_refused() {
    let s = signed_setup();
    let e = &s.fx.e;
    let mut payment = binding(e, 3);
    payment.mandate_id = BytesN::from_array(e, &[8; 32]);
    assert!(transfer_bound(&s, &s.fx.prov, 1, 1, payment).is_err());
    let mut payment = binding(e, 3); payment.valid_until = 5;
    e.ledger().set_sequence_number(5);
    assert!(transfer_bound(&s, &s.fx.prov, 1, 2, payment).is_err());
}

#[test]
fn modified_binding_invalidates_the_signature() {
    let s = signed_setup();
    let e = &s.fx.e;
    for field in 0..4 {
        let mut entry = payment_entry(&s, &s.fx.prov, 1, 1, binding(e, 3));
        let SorobanCredentials::Address(ref mut credentials) = entry.credentials else { unreachable!() };
        let v = Val::try_from_val(e, &credentials.signature).unwrap();
        let mut payload = MandateSignature::try_from_val(e, &v).unwrap();
        match field {
            0 => payload.payment.reference = BytesN::from_array(e, &[8; 32]),
            1 => payload.payment.payment_id = BytesN::from_array(e, &[8; 32]),
            2 => payload.payment.mandate_id = BytesN::from_array(e, &[8; 32]),
            _ => payload.payment.valid_until = 99,
        }
        credentials.signature = to_scval(e, payload);
        e.set_auths(&[entry]);
        assert!(token::TokenClient::new(e, &s.fx.usdc).try_transfer(&s.agent, &s.fx.prov, &1).is_err());
    }
}

#[test]
fn exact_mandate_enforces_reference_amount_and_single_use_even_with_new_ids() {
    let s = signed_setup();
    let e = &s.fx.e;
    let params = MandateParams { id: BytesN::from_array(e, &[9; 32]), intent_hash: BytesN::from_array(e, &[2; 32]), expiry: 1_000,
        scope: MandateScope::Exact(PaymentTerms { asset: s.fx.usdc.clone(), payee: s.fx.prov.clone(), amount: 1_000_000, reference: BytesN::from_array(e, &[4; 32]) }) };
    s.fx.pool.create_mandate(&s.agent, &params);
    let mut payment = binding(e, 3); payment.mandate_id = params.id.clone();
    assert!(transfer_bound(&s, &s.fx.prov, 999_999, 1, payment.clone()).is_err());
    let mut wrong = payment.clone(); wrong.reference = BytesN::from_array(e, &[8; 32]);
    assert!(transfer_bound(&s, &s.fx.prov, 1_000_000, 2, wrong).is_err());
    assert!(transfer_bound(&s, &s.fx.prov, 1_000_000, 3, payment.clone()).is_ok());
    payment.payment_id = BytesN::from_array(e, &[10; 32]);
    assert!(transfer_bound(&s, &s.fx.prov, 1_000_000, 4, payment).is_err());
    assert_eq!(bal(&s.fx, &s.fx.prov), 1_000_000);
}

#[test]
fn mandate_creation_requires_original_owner_and_ids_cannot_be_replaced() {
    let s = signed_setup();
    let e = &s.fx.e;
    let mut params = s.fx.pool.get_mandate(&s.agent, &binding(e, 3).mandate_id).first().unwrap().params;
    assert!(s.fx.pool.try_create_mandate(&s.agent, &params).is_err());
    params.id = BytesN::from_array(e, &[9; 32]);
    e.set_auths(&[]);
    assert!(s.fx.pool.try_create_mandate(&s.agent, &params).is_err());
    assert!(s.fx.pool.try_revoke_mandate(&s.agent, &binding(e, 3).mandate_id).is_err());
    let policy = CovenantPolicyContractClient::new(e, &s.fx.policy);
    assert!(policy.try_create_mandate(&s.agent, &params).is_err());
}

#[test]
fn mandate_approval_records_owner_auth_and_revocation_is_terminal() {
    let s = signed_setup();
    let e = &s.fx.e;
    let mut params = s.fx.pool.get_mandate(&s.agent, &binding(e, 3).mandate_id).first().unwrap().params;
    params.id = BytesN::from_array(e, &[9; 32]);
    s.fx.pool.create_mandate(&s.agent, &params);
    assert_eq!(e.auths()[0].0, s.fx.owner);
    assert_eq!(e.auths()[0].1.function, soroban_sdk::testutils::AuthorizedFunction::Contract((s.fx.pool_addr.clone(), soroban_sdk::Symbol::new(e, "create_mandate"), (s.agent.clone(), params.clone()).into_val(e))));
    s.fx.pool.revoke_mandate(&s.agent, &params.id);
    assert!(s.fx.pool.try_create_mandate(&s.agent, &params).is_err());
    assert!(s.fx.pool.get_mandate(&s.agent, &params.id).first().unwrap().revoked);
}

#[test]
fn payment_and_mandate_deadlines_are_checked_onchain() {
    let s = signed_setup();
    let e = &s.fx.e;
    let mut params = s.fx.pool.get_mandate(&s.agent, &binding(e, 3).mandate_id).first().unwrap().params;
    params.id = BytesN::from_array(e, &[9; 32]); params.expiry = 50;
    s.fx.pool.create_mandate(&s.agent, &params);
    let mut payment = binding(e, 3); payment.mandate_id = params.id.clone();
    // Deadline beyond grant lifetime is refused even while the grant is live.
    assert!(transfer_bound(&s, &s.fx.prov, 1, 1, payment.clone()).is_err());
    payment.valid_until = 50;
    e.ledger().set_sequence_number(50);
    assert!(transfer_bound(&s, &s.fx.prov, 1, 2, payment).is_err());
    assert_eq!(s.fx.pool.get_mandate(&s.agent, &params.id).first().unwrap().spent, 0);
}

#[test]
fn arbitrary_policy_consumption_cannot_forge_a_receipt() {
    let s = signed_setup();
    let e = &s.fx.e;
    let payment = binding(e, 3);
    let terms = PaymentTerms { asset: s.fx.usdc.clone(), payee: s.fx.prov.clone(), amount: 1, reference: payment.reference.clone() };
    let host = BytesN::from_array(e, &[7; 32]);
    let inv = contract_fn(&s.fx.policy, "consume_mandate", std::vec![to_scval(e, s.agent.clone()), to_scval(e, payment.clone()), to_scval(e, terms.clone()), to_scval(e, host.clone())]);
    e.set_auths(&[signed_entry(e, &s.agent, &s.signer, &s.key, inv)]);
    let policy = CovenantPolicyContractClient::new(e, &s.fx.policy);
    assert!(policy.try_consume_mandate(&s.agent, &payment, &terms, &host).is_err());
    assert!(s.fx.pool.get_payment(&s.agent, &payment.payment_id).is_empty());
}

#[test]
fn mandate_cannot_widen_a_covenant_or_change_its_asset() {
    let s = signed_setup();
    let e = &s.fx.e;
    let base = s.fx.pool.get_mandate(&s.agent, &binding(e, 3).mandate_id).first().unwrap().params;
    for case in 0..7 {
        let mut params = base.clone(); params.id = BytesN::from_array(e, &[9; 32]);
        match case {
            0 => params.expiry = 10_001,
            1 => params.id = BytesN::from_array(e, &[0; 32]),
            2 => params.intent_hash = BytesN::from_array(e, &[0; 32]),
            3 => params.scope = MandateScope::Budget(MandateBudget { payees: vec![e, s.fx.prov.clone()], per_payment_cap: 2_000_001, total_cap: LIMIT }),
            4 => params.scope = MandateScope::Budget(MandateBudget { payees: vec![e, s.fx.prov.clone()], per_payment_cap: -1, total_cap: LIMIT }),
            5 => params.scope = MandateScope::Budget(MandateBudget { payees: vec![e, Address::generate(e)], per_payment_cap: 1, total_cap: LIMIT }),
            _ => params.scope = MandateScope::Exact(PaymentTerms { asset: Address::generate(e), payee: s.fx.prov.clone(), amount: 1, reference: binding(e, 3).reference }),
        }
        assert!(s.fx.pool.try_create_mandate(&s.agent, &params).is_err());
    }
}

#[test]
fn existing_covenant_total_is_shared_across_mandates() {
    let s = signed_setup();
    let e = &s.fx.e;
    let mut params = s.fx.pool.get_mandate(&s.agent, &binding(e, 3).mandate_id).first().unwrap().params;
    params.id = BytesN::from_array(e, &[9; 32]);
    s.fx.pool.create_mandate(&s.agent, &params);
    token::StellarAssetClient::new(e, &s.fx.usdc).mint(&s.agent, &LIMIT);
    assert!(transfer_bound(&s, &s.fx.prov, 2_000_000, 1, binding(e, 3)).is_ok());
    assert!(transfer_bound(&s, &s.fx.prov, 2_000_000, 2, binding(e, 4)).is_ok());
    let mut payment = binding(e, 5); payment.mandate_id = params.id;
    assert!(transfer_bound(&s, &s.fx.prov, 2_000_000, 3, payment).is_err());
    assert_eq!(bal(&s.fx, &s.fx.prov), 4_000_000);
}

#[test]
fn durable_receipt_has_its_own_persistent_ttl_and_event() {
    use soroban_sdk::{testutils::{storage::Persistent as _, Events as _}, xdr::ContractEventBody};
    use kovan_covenant_policy::mandate::MandateKey;
    let s = signed_setup();
    assert!(transfer_with_signature(&s, &s.fx.prov, 1).is_ok());
    let events = s.fx.e.events().all().filter_by_contract(&s.fx.policy);
    assert!(events.events().iter().any(|event| {
        let ContractEventBody::V0(body) = &event.body;
        body.topics.first() == Some(&ScVal::Symbol("mandate_payment".try_into().unwrap()))
    }));
    s.fx.e.as_contract(&s.fx.policy, || {
        assert!(s.fx.e.storage().persistent().get_ttl(&MandateKey::Receipt(s.agent.clone(), binding(&s.fx.e, 3).payment_id)) > 1_000);
    });
}

#[test]
fn address_v2_authentication_works_with_mandate_binding() {
    use soroban_sdk::xdr::HashIdPreimageSorobanAuthorizationWithAddress;
    let s = signed_setup();
    let e = &s.fx.e;
    let payment = binding(e, 3);
    let mut entry = payment_entry(&s, &s.fx.prov, 1, 1, payment.clone());
    let SorobanCredentials::Address(mut credentials) = entry.credentials else { unreachable!() };
    let preimage = HashIdPreimage::SorobanAuthorizationWithAddress(HashIdPreimageSorobanAuthorizationWithAddress {
        network_id: XdrHash(e.ledger().get().network_id), nonce: 1, signature_expiration_ledger: EXPIRATION_LEDGER,
        address: (&s.agent).into(), invocation: entry.root_invocation.clone(),
    });
    let host = e.crypto().sha256(&Bytes::from_slice(e, &preimage.to_xdr(Limits::none()).unwrap())).to_bytes();
    let digest = AuthDigestPreimage { account: s.agent.clone(), signature_payload: payment_payload(e, &host, &payment).to_bytes(), context_rule_ids: vec![e, 0u32] }.digest(e);
    credentials.signature = to_scval(e, MandateSignature { version: 1, payment,
        auth: AuthPayload { signers: map![e, (s.signer.clone(), Bytes::from_array(e, &s.key.sign(&digest.to_array()).to_bytes()))], context_rule_ids: vec![e, 0u32] } });
    entry.credentials = SorobanCredentials::AddressV2(credentials);
    e.set_auths(&[entry]);
    token::TokenClient::new(e, &s.fx.usdc).transfer(&s.agent, &s.fx.prov, &1);
    assert_eq!(bal(&s.fx, &s.fx.prov), 1);
}
