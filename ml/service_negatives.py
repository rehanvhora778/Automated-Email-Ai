"""Generate legitimate service notices — ham whose words collide with old spam.

`work_negatives.py` fixed ordinary business mail. This fixes a narrower and
sharper failure: legitimate transactional notices that happen to use the
vocabulary of a classic spam category.

The example that prompted it: "Your prescription is ready for collection at the
pharmacy on Mill Road" scored 83.8% spam. Asked which tokens drove that, the
model answers `prescription` and `pharmacy`. SpamAssassin was assembled when
pharmaceutical spam was the dominant genre, so in the training data essentially
every mention of a prescription was junk, and the model learned the word rather
than the intent. The same trap is set for several other categories:

    pharmacy / prescription / medication   <- pharma spam
    loan / mortgage / rate / approved      <- loan spam
    delivery / parcel / tracking           <- parcel scams
    statement / account / balance          <- banking phish
    winner / prize / claim (a real one)    <- lottery spam

These are the messages where the word appears in a genuine notice from a real
service, so they teach the model that context decides, not vocabulary.

Same construction as `hard_negatives.py` and `work_negatives.py`: combinatorial
slots, not a handful of templates, and SYNTHETIC — the same documented
limitation applies. See ml/README.md.

A note on honesty, because it matters here. The held-out set in
`eval_workmail.py` previously used a pharmacy notice as an example of a register
the model had NOT been taught. Adding this module teaches that register, so that
group would stop measuring generalisation if left as it was. The eval was
restructured at the same time: those messages moved into a group labelled as
taught, and a fresh untaught group was written from registers nothing here
generates. Reporting an improvement on an eval you have since trained against is
the easiest way to fool yourself.

n=200 was swept like the last one, and less is needed here than for business
mail: 200 lifts the corpus F1 to 0.9903 from 0.9889 while clearing every failure
in the held-out set. Past that it costs recall and buys nothing (0.9833 at 1000).

Run:  python service_negatives.py    -> writes data/service_negatives.csv
"""
import random
from pathlib import Path

import pandas as pd

OUT = Path(__file__).parent / "data" / "service_negatives.csv"
SEED = 23

NAMES = [
    "Priya", "Daniel", "Sarah", "Ahmed", "Maria", "James", "Wei", "Fatima",
    "Carlos", "Anna", "Thomas", "Yuki", "Olivia", "Ravi", "Sofia", "Marcus",
]
STREETS = [
    "Mill Road", "High Street", "Station Road", "Church Lane", "Park Avenue",
    "Bridge Street", "Kings Road", "Market Square", "Victoria Street",
]
BRANDS = [
    "Riverside Pharmacy", "Central Clinic", "Oakwood Surgery", "Meadow Dental",
    "Northgate Optician", "the practice", "your local branch", "the depot",
]
WINDOWS = [
    "between 9am and 12pm", "any weekday before 6pm", "on Tuesday afternoon",
    "within the next seven days", "from Monday", "until the end of the month",
]
BRING = [
    "Please bring photo ID and your booking reference.",
    "Bring your appointment card if you still have it.",
    "You will need your reference number when you arrive.",
    "No need to bring anything, we have your details on file.",
    "Please bring a form of identification with you.",
]
NO_ACTION = [
    "If you have already collected it, please ignore this message.",
    "No reply is needed - this is for your records.",
    "There is nothing further you need to do.",
    "If this is not convenient, call us and we will rearrange.",
    "You can reschedule online or by calling the number on your card.",
]

BODIES = {
    # pharmacy / prescription: the register that failed
    "pharmacy": [
        "Your prescription is ready for collection at {brand} on {street}. Collect it {window}. {bring} {no_action}",
        "The repeat prescription you requested has been dispensed and is waiting at {brand}. {bring}",
        "A reminder that your medication is due for review before the next repeat can be issued. Please book a short appointment with {brand}. {no_action}",
        "Your prescription request has been approved by the prescriber and sent to {brand} on {street}. It will be ready {window}.",
    ],
    "appointment": [
        "Your appointment at {brand} is confirmed for {window}. {bring} {no_action}",
        "This is a reminder of your check-up at {brand} on {street}. {no_action}",
        "We have had a cancellation and can offer you an earlier slot {window}. Reply or call if you would like it.",
        "Your test results are back and are normal. The practice will not need to see you, but do call if you have questions.",
    ],
    # delivery / tracking: collides with parcel scams
    "delivery": [
        "Your order has been dispatched and is due for delivery {window}. You do not need to be home - it will be left with a neighbour if you are out.",
        "We tried to deliver your parcel today. It is now at {brand} on {street} and can be collected {window}. {bring}",
        "Your delivery has been rescheduled to {window} because of a depot delay. Sorry for the inconvenience. {no_action}",
        "The item you returned has reached our warehouse and the refund has been issued to your original payment method.",
    ],
    # statement / account / balance: collides with banking phish
    "statement": [
        "Your monthly statement is now available in the app. There is nothing to action; this notice is for your records.",
        "Your annual summary for the year is ready. You can view it by signing in the way you normally do. {no_action}",
        "The direct debit for this month has been collected as scheduled. Your balance and next payment date are shown in the app.",
        "We have updated our terms of service. The changes take effect {window} and are summarised on our website. {no_action}",
    ],
    # loan / mortgage / rate: collides with loan spam
    "finance": [
        "Your fixed rate ends {window}. Nothing happens automatically - if you would like to discuss options, book a call with your adviser.",
        "The overpayment you made has been applied to your balance and your next statement will reflect it.",
        "Your renewal quote is ready to view in your account. Your cover continues either way; this is a reminder, not a request for payment.",
        "We have received your documents and your application has moved to the review stage. We will write again once a decision is made.",
    ],
    "utility": [
        "Water will be shut off on {street} {window} while we replace a valve. Sorry for the disruption. {no_action}",
        "Your meter reading has been received and this month's bill has been adjusted accordingly.",
        "Planned engineering work will affect broadband in your area {window}. No action is needed and service will restore automatically.",
        "Your tariff is changing {window}. The new rates are on your latest bill and you do not need to do anything.",
    ],
    "civic": [
        "Your library loan is due back {window}. You can renew online if nobody has reserved it. {no_action}",
        "Your vehicle is booked in for its test on {street} {window}. It usually takes about ninety minutes.",
        "Your provisional results are available on the student portal and transcripts will follow by post.",
        "You have been selected for jury service. Please complete the reply form within the next two weeks. {bring}",
    ],
}

SUBJECTS = {
    "pharmacy": ["Prescription ready", "Your prescription", "Repeat prescription", "Medication review due"],
    "appointment": ["Appointment reminder", "Your appointment is confirmed", "Earlier slot available", "Your results"],
    "delivery": ["Your order is on its way", "Delivery attempted", "Delivery rescheduled", "Refund issued"],
    "statement": ["Your statement is ready", "Annual summary", "Direct debit collected", "Changes to our terms"],
    "finance": ["Your fixed rate is ending", "Overpayment received", "Renewal quote ready", "Application update"],
    "utility": ["Planned works on {street}", "Meter reading received", "Broadband works in your area", "Tariff change"],
    "civic": ["Library loan due", "Test booking confirmed", "Your results", "Jury service"],
}


def _fill(template: str, rng: random.Random) -> str:
    return template.format(
        name=rng.choice(NAMES),
        street=rng.choice(STREETS),
        brand=rng.choice(BRANDS),
        window=rng.choice(WINDOWS),
        bring=rng.choice(BRING),
        no_action=rng.choice(NO_ACTION),
    )


def generate(n: int = 200, seed: int = SEED) -> pd.DataFrame:
    rng = random.Random(seed)
    rows = []
    kinds = list(BODIES)
    openers = ["Hi {name},", "Dear {name},", "{name},", "Hello {name},", "Dear customer,", "Dear resident,"]
    signoffs = ["Kind regards,", "Best wishes,", "Regards,", "Many thanks,", "Yours sincerely,"]

    for _ in range(n):
        kind = rng.choice(kinds)
        subject = _fill(rng.choice(SUBJECTS[kind]), rng)
        opener = _fill(rng.choice(openers), rng)
        body = _fill(rng.choice(BODIES[kind]), rng)
        signoff = f"{rng.choice(signoffs)} {rng.choice(BRANDS)}"
        text = f"{subject} {opener} {body} {signoff}"
        rows.append({"text": " ".join(text.split()), "label": 0, "source": "service_ham"})

    return pd.DataFrame(rows).drop_duplicates(subset="text").reset_index(drop=True)


def main() -> None:
    df = generate()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print(f"wrote {OUT}")
    print(f"  unique service notices: {len(df)}")
    print("\nsamples:\n")
    for i in range(3):
        print(" ", df.iloc[i]["text"][:150], "…")


if __name__ == "__main__":
    main()
