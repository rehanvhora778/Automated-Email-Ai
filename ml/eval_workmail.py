"""Held-out evaluation: does the spam model leave ordinary mail alone?

The corpus test split says F1 0.989, and that is true — of SpamAssassin. It says
nothing about the mail this app actually reads, because the ham it was measured
against is 2002 mailing list traffic. This set measures the deployment
distribution instead: mail a working person receives today.

Four groups, deliberately separated so the numbers mean different things:

  IN_REGISTER      business mail of the kinds work_negatives.py generates, but
                   written by hand with different sentences. Tests whether the
                   model learned the register or memorised the templates.
  SERVICE_NOTICES  transactional notices of the kinds service_negatives.py
                   generates — pharmacy, delivery, statements, utilities — again
                   phrased by hand. Same test, second register.
  OUT_OF_REGISTER  legitimate mail nothing here generates: personal, family,
                   community, hobby. The only group that measures whether the
                   fix reaches past what it was taught.
  SPAM             real-shaped junk, including pharmaceutical spam specifically,
                   because SERVICE_NOTICES teaches the model that `prescription`
                   and `pharmacy` can be innocent — and that is precisely how
                   pharma spam detection would break.

Nothing here is training data, and none of it is generated.

A note on how this file changed. It first shipped with three groups, and its
OUT_OF_REGISTER held the pharmacy notice the model got wrong. Teaching that
register via service_negatives.py would have turned an untaught probe into a
taught one while the label still claimed otherwise, so those messages moved into
SERVICE_NOTICES and a genuinely untaught group was written to replace them. An
eval you have since trained against measures memorisation, not generalisation.

Run after training:

    python eval_workmail.py
"""
import sys
from pathlib import Path

MODEL = Path(__file__).parent / "models" / "spam_clf.joblib"

# Ordinary business mail — the register work_negatives.py teaches, phrased
# differently. These are the messages the model used to call spam.
IN_REGISTER = [
    "Hi Rehan, could you review the attached contract draft before our call on Thursday? Let me know if the indemnity clause looks right to you. Thanks, Priya",
    "Hi team, sharing the deck for tomorrow's quarterly review. Slides 12-18 cover the pipeline changes. Please add comments before 5pm today.",
    "Following up on my last note - do you have capacity to take the onboarding work this sprint, or should I reassign it? No pressure either way.",
    "Hi Rehan, the client has approved the revised scope. I'll raise the change order this afternoon and send the updated schedule once finance signs off.",
    "Quick one: are you free at 3pm on Wednesday for the vendor call? If not I can move it to Thursday morning.",
    "Please find attached the signed NDA. Could you confirm receipt and let me know the next steps for the technical review?",
    "Hi Rehan, our records show invoice INV-2291 as outstanding. Could you check whether payment was released on your side? Happy to resend the invoice if useful.",
    "Thanks for the walkthrough yesterday. I've written up the action items and assigned owners in the tracker. Shout if anything looks wrong.",
    "Hi, we'd like to move your interview to Tuesday 2pm as the panel has a conflict. Does that work for you? Apologies for the short notice.",
    "The deployment went out at 14:20 and metrics look stable. I'll keep monitoring overnight and roll back if error rates climb.",
    "Hi Rehan, attaching the budget forecast for next quarter. The headcount line assumes two hires in October - let me know if that assumption still holds.",
    "Could you send over the latest version of the requirements doc? The one in the shared drive looks like it predates last week's decisions.",
    "Reminder that timesheets are due Friday. Let me know if you need the deadline extended for the contractor invoices.",
    "Hi, I'm following up on our conversation about the partnership. Would it help if I put together a short proposal covering scope and pricing?",
    "The legal team came back with two comments on clause 7.2. I've summarised them below - could you let me know if you're comfortable with the wording?",
    "Hi Rehan, welcome aboard! Your laptop should arrive Monday. I've booked a 30-minute intro call for Tuesday so we can walk through the codebase together.",
    "Apologies for the delay - I was out sick last week. Catching up on the review comments now and will have the revised draft to you by Wednesday.",
    "Please approve the purchase request for the annual license renewal. The finance deadline is end of month and we lose the discount after that.",
    "Hi, the customer reported a billing discrepancy on their October statement. Could someone from your side take a look before we respond to them?",
    "Sharing notes from the architecture discussion. Main decision: we're keeping the existing queue and revisiting sharding after the migration.",
]

# Transactional notices — the register service_negatives.py teaches, phrased by
# hand. The pharmacy line scored 83.8% spam before that module existed, because
# `prescription` and `pharmacy` were pure spam tokens in a corpus assembled when
# pharmaceutical junk was the dominant genre.
SERVICE_NOTICES = [
    "Your prescription is ready for collection at the pharmacy on Mill Road. Please bring photo ID and your booking reference when you come in.",
    "Your library loan on 'Pattern Recognition and Machine Learning' is due back on the 14th. You can renew it online if nobody has reserved it.",
    "Dear resident, water will be shut off on Tuesday between 9am and 2pm while we replace the mains valve on your street. Sorry for the disruption.",
    "Congratulations on finishing the semester. Your provisional results are available on the student portal, and transcripts will follow by post.",
    "Your car is booked in for its MOT on the 21st. It usually takes about ninety minutes and we'll call you if anything needs doing.",
    "Your repeat medication is due for review before the next prescription can be issued. Please book a short appointment with the surgery.",
    "We tried to deliver your parcel today and have left it at the depot on Station Road. It can be collected any weekday before 6pm.",
    "Your monthly statement is now available in the app. There is nothing to action - this notice is just for your records.",
    "Your fixed rate ends in November. Nothing happens automatically, but if you would like to talk through the options, book a call with your adviser.",
    "Planned engineering work will affect broadband in your area on Thursday morning. Service will restore automatically and no action is needed.",
]

# Legitimate mail that NOTHING in ml/ generates: personal, family, community,
# hobby. This is the only group that tests whether the fix reaches past its
# training, so it is kept clear of every register the generators cover.
OUT_OF_REGISTER = [
    "Hey, are we still on for football Saturday? Marcus said he can drive if we're short on cars. Let me know either way.",
    "Hi, thanks for volunteering at the weekend. We served 240 meals, which is the most we've managed in one day. Photos are in the shared album.",
    "Just letting you know I've booked the flights for the trip in March. Send me your passport details when you get a chance and I'll add them.",
    "The landlord has agreed to fix the boiler next Thursday between 10 and 12. Someone will need to be home to let the engineer in.",
    "Thanks for your feedback on the draft chapter. I've taken most of it on board - the section on methodology needed the cut you suggested.",
    "Mum's birthday is the 12th and I've booked the restaurant for seven. Can you let me know if Dad is bringing anyone so I can change the table?",
    "Book club is moving to the second Tuesday from now on because the hall is double-booked. We're on chapter nine when we next meet.",
    "Sorry I missed your call - I was on the train and the signal dropped. Free tomorrow evening if you want to try again.",
    "The allotment committee agreed to replace the fence along the north side. Anyone who can spare a Saturday morning, put your name on the list.",
    "Great news, we got the tickets. Row H, which is closer than I expected. I'll send you the booking so you have it on your phone too.",
]

# Real-shaped junk. Without this group, "call everything ham" would look perfect.
SPAM = [
    "CONGRATULATIONS! You have WON a FREE $1000 Walmart gift card. Click here now to claim your prize before it expires! Limited time offer, act fast!!!",
    "Dear Friend, I am the widow of a former government minister and I need your urgent assistance to transfer $12,500,000 out of the country. You will receive 30%.",
    "LOSE 30 POUNDS IN 30 DAYS!! Doctors HATE this one weird trick. No diet, no exercise, guaranteed results or your money back. Order now while stocks last.",
    "Get CHEAP MEDS online, no prescription needed! V1AGRA, C1ALIS and more at 80% OFF retail. Discreet shipping worldwide. Click here to order today.",
    "Make $5000 per week working from home! No experience required. Thousands have already joined our program. Reply now to secure your spot, only 12 places left!",
    "Your loan pre-approval is READY. $50,000 available at 0% APR regardless of credit history. No paperwork. Click the link and get funded within 24 hours.",
    "FINAL NOTICE: your domain listing expires today. Renew immediately to avoid permanent loss of your search engine placement. Payment link enclosed.",
    "Hot singles in your area are waiting to meet you tonight! Click here to view profiles. 100% free registration, no credit card required, join now.",
    # Pharma spam specifically: SERVICE_NOTICES teaches that a prescription can
    # be innocent, and this is where that lesson would go too far if it did.
    "ONLINE PHARMACY - no prescription required! All popular medications at up to 80% off. Discreet worldwide shipping, no doctor visit needed. Order now!",
    "Buy prescription drugs online without a prescription. Lowest prices guaranteed on all pain medication. No questions asked, ships same day, click here.",
    "Your PHARMACY order is waiting! Cheap generic pills delivered to your door. No prescription, no consultation, no hassle. Limited stock, act today!",
]


def band(prob: float) -> str:
    """The bands ml_service reports."""
    if prob >= 0.80:
        return "Spam"
    return "Suspicious" if prob >= 0.45 else "Not spam"


def score(model, texts):
    probs = [float(model.predict_proba([t])[0][1]) for t in texts]
    counts = {"Spam": 0, "Suspicious": 0, "Not spam": 0}
    for p in probs:
        counts[band(p)] += 1
    return probs, counts


def report(name, texts, model, ham: bool):
    probs, counts = score(model, texts)
    n = len(texts)
    wrong = (counts["Spam"] + counts["Suspicious"]) if ham else counts["Not spam"]
    print(f"\n{name}  (n={n}, {'ham' if ham else 'spam'})")
    print(f"  Spam {counts['Spam']:>3}   Suspicious {counts['Suspicious']:>3}   "
          f"Not spam {counts['Not spam']:>3}")
    print(f"  mean spam probability : {sum(probs) / n * 100:.1f}%")
    print(f"  MISCLASSIFIED         : {wrong}/{n}  ({wrong / n * 100:.0f}%)")
    for p, t in sorted(zip(probs, texts), reverse=ham)[:3]:
        print(f"    {p * 100:>5.1f}%  {t[:72]}...")
    return wrong, n


def main() -> None:
    if not MODEL.exists():
        sys.exit(f"no model at {MODEL} - run `python train.py` first")
    import joblib

    model = joblib.load(MODEL)
    print(f"model: {MODEL.name}")

    w1, n1 = report("IN_REGISTER      business mail, unseen phrasing", IN_REGISTER, model, ham=True)
    w2, n2 = report("SERVICE_NOTICES  transactional mail, unseen phrasing", SERVICE_NOTICES, model, ham=True)
    w3, n3 = report("OUT_OF_REGISTER  registers nothing generates", OUT_OF_REGISTER, model, ham=True)
    w4, n4 = report("SPAM             real junk (guards the other way)", SPAM, model, ham=False)

    ham_wrong, ham_n = w1 + w2 + w3, n1 + n2 + n3
    print("\n" + "=" * 62)
    print(f"  ham false-positive rate : {ham_wrong}/{ham_n}  ({ham_wrong / ham_n * 100:.0f}%)")
    print(f"  spam missed             : {w4}/{n4}  ({w4 / n4 * 100:.0f}%)")
    print("=" * 62)


if __name__ == "__main__":
    main()
