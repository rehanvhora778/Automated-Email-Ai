"""Generate ordinary business correspondence — the ham class the corpus lacks.

SpamAssassin's ham is 2002-era open-source mailing list traffic. Look at what
the trained model reports as its most ham-ish features and the problem is plain:
`2002`, `wrote`, `url http`, `spambayes`, `spamassassin talk`, `razor`, `rpm`,
`org`, `users`. It has not learned "ham"; it has learned "a Linux mailing list
thread from 2002". Meanwhile its spam side leans on `your`, `our`, `please`,
`we`, `business` — the everyday vocabulary of work email.

So a message like "our records show invoice INV-2291 as outstanding, could you
check whether payment was released" carries every spam-leaning token and none of
the ham markers, and the model called it spam at 81% confidence. 35% of ordinary
work mail landed outside "Not spam" before these were added.

This module supplies the missing register: routine internal and client email
about scheduling, invoices, approvals, reviews, hiring and projects. It is the
same remedy `hard_negatives.py` applies to the phishing model, aimed at a
different gap — that one teaches "legitimate security mail", this one teaches
"ordinary business mail".

Built combinatorially from independent slots rather than a few templates, so the
model learns the register rather than memorising sentences. That it works is
measurable: three seeds producing 400 samples each with zero overlap between
them train models that score identically, on the corpus and on the held-out set
alike. The register is what carries, not the particular wording.

n=400 was chosen by sweeping it. More is not better — at 1400 the added ham
shifts the class prior far enough to cost recall on the corpus (F1 0.9833),
while 400 improves the corpus F1 to 0.9889 from a 0.9863 baseline and fixes the
false positives at the same time.

These are SYNTHETIC, and that is a real limitation documented in ml/README.md:
the model can only learn what is represented here, and a legitimate style not
covered may still be misread. A corpus of real modern business mail is the
honest fix; offline, this is the closest available substitute. The held-out
evaluation in `eval_workmail.py` is written separately by hand, so it measures
generalisation rather than echoing these templates back.

Run:  python work_negatives.py      -> writes data/work_negatives.csv
"""
import random
from pathlib import Path

import pandas as pd

OUT = Path(__file__).parent / "data" / "work_negatives.csv"
SEED = 11

NAMES = [
    "Priya", "Daniel", "Sarah", "Ahmed", "Maria", "James", "Wei", "Fatima",
    "Carlos", "Anna", "Thomas", "Yuki", "Olivia", "Ravi", "Sofia", "Marcus",
    "Nadia", "Kenji", "Elena", "Tom",
]
COMPANIES = [
    "Northwind", "Acme", "Contoso", "Fabrikam", "Globex", "Initech",
    "Meridian", "Blackwood", "Lumen Partners", "Castleford",
]
TEAMS = [
    "the finance team", "legal", "the design team", "procurement", "our vendor",
    "the platform team", "the client", "the account team", "operations",
]
DAYS = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "Monday morning", "Thursday afternoon", "early next week",
]
TIMES = ["9am", "10:30", "11am", "2pm", "3:30", "4pm", "midday"]
DEADLINES = [
    "by Friday", "before the end of the month", "by close of play tomorrow",
    "before the review on Thursday", "by the 15th", "ahead of next week's meeting",
    "before the quarter closes", "by end of day",
]
DOCS = [
    "the scope document", "the contract draft", "the revised proposal",
    "the statement of work", "the budget forecast", "the requirements doc",
    "the migration plan", "the quarterly deck", "the vendor agreement",
    "the test plan", "the onboarding checklist", "the architecture note",
]
REFS = ["INV-{n}", "PO-{n}", "SOW-{n}", "CR-{n}", "TKT-{n}", "REQ-{n}"]

# Sign-offs a colleague actually uses. Kept varied so the model does not treat
# any single closing as the signal.
SIGNOFFS = [
    "Thanks,", "Best,", "Cheers,", "Many thanks,", "Best regards,",
    "Thanks in advance,", "Appreciate it,", "Regards,",
]
OPENERS = [
    "Hi {name},", "Hi {name} -", "{name},", "Morning {name},",
    "Hi {name}, hope you're well.", "Hi {name}, quick one.",
]

# Each body is a self-contained routine message. The vocabulary deliberately
# overlaps with what the model currently reads as spam — invoices, approvals,
# payment, offers, records, "please", "your" — because that overlap is exactly
# what it needs to stop treating as evidence.
BODIES = {
    "scheduling": [
        "Are you free {day} at {time} for the call with {team}? If not I can move it to {day2}.",
        "I need to move our {day} catch-up - {team} pushed their review. Would {day2} at {time} work instead?",
        "Sending a hold for {day} {time} to walk through {doc}. Decline if that clashes and I'll find another slot.",
        "Can we push the {day} sync by half an hour? Something has come up with {team} that I need to cover first.",
    ],
    "review": [
        "Could you review {doc} before our call on {day}? Let me know if anything looks wrong.",
        "I've attached {doc} with this week's changes marked up. Comments {deadline} would be great.",
        "{team} came back with two comments on {doc}. I've summarised them below - are you comfortable with the wording?",
        "Here is the latest version of {doc}. The one on the shared drive predates last week's decisions, so use this one.",
    ],
    "invoice": [
        "Our records show {ref} as outstanding. Could you check whether payment was released on your side? Happy to resend it.",
        "Attaching {ref} for last month's work. Payment terms are 30 days as usual - let me know if you need it split differently.",
        "{team} flagged a discrepancy on {ref}. Could someone take a look before we respond to the client?",
        "Following up on {ref}, which we sent on the 3rd. No rush, just want to make sure it reached the right inbox.",
        "The renewal quote is attached as {ref}. The discount holds {deadline}, after which it goes back to list price.",
    ],
    "approval": [
        "Please approve the purchase request for the annual licence renewal. Finance needs it {deadline}.",
        "Could you sign off on {ref} so procurement can raise the order? It's the same vendor as last year.",
        "This needs your approval before {team} can proceed. I've included the figures and the comparison with last quarter.",
        "Are you happy for me to accept the revised terms on {ref}? I don't want to commit without your view.",
    ],
    "project": [
        "The deployment went out and metrics look stable. I'll keep monitoring overnight and roll back if error rates climb.",
        "Sharing notes from the architecture discussion. Main decision: we're keeping the existing queue and revisiting sharding after the migration.",
        "Status update: {doc} is done, the integration work slips to next sprint, and we're still blocked on {team}.",
        "I've written up the action items from yesterday and assigned owners in the tracker. Shout if anything looks wrong.",
    ],
    "hiring": [
        "We'd like to move your interview to {day} at {time} as the panel has a conflict. Does that work? Apologies for the short notice.",
        "Thanks for making time yesterday. The team enjoyed the conversation and we'll come back to you with next steps {deadline}.",
        "Welcome aboard. Your laptop should arrive {day} and I've booked a short intro call so we can walk through things together.",
        "Could you send over your availability for a second conversation? Anything {deadline} works on our side.",
    ],
    "client": [
        "The client has approved the revised scope. I'll raise the change order this afternoon and send the updated schedule once {team} sign off.",
        "I'm following up on our conversation about the partnership. Would it help if I put together a short proposal covering scope and pricing?",
        "Please find {doc} attached. Could you confirm receipt and let me know the next steps for the technical review?",
        "{team} asked whether we can bring the delivery date forward. I said I'd check with you before committing to anything.",
    ],
    "admin": [
        "Reminder that timesheets are due {deadline}. Let me know if you need an extension for the contractor invoices.",
        "Apologies for the delay - I was out last week. Catching up on the comments now and will have the revised draft to you {deadline}.",
        "I'm on leave from {day} and back the following week. {name2} is covering, so please copy them on anything urgent.",
        "Booking the team offsite - could you let me know which of the {day} or {day2} options suits you {deadline}?",
    ],
}

SUBJECTS = {
    "scheduling": ["Call on {day}?", "Moving our {day} sync", "Hold: {day} {time}", "Quick reschedule"],
    "review": ["Review of {doc}", "{doc} - your comments?", "Updated {doc} attached", "Comments on {doc}"],
    "invoice": ["{ref}", "{ref} - payment status", "Invoice query", "Renewal quote {ref}"],
    "approval": ["Approval needed: {ref}", "Sign-off on {ref}", "Purchase request", "Your approval on the renewal"],
    "project": ["Deployment update", "Notes from the architecture call", "Weekly status", "Action items from yesterday"],
    "hiring": ["Interview time change", "Thanks for your time", "Welcome to the team", "Next steps"],
    "client": ["Scope approved", "Partnership follow-up", "{doc} for review", "Delivery date question"],
    "admin": ["Timesheets {deadline}", "Catching up", "Out of office next week", "Offsite dates"],
}


def _fill(template: str, rng: random.Random) -> str:
    ref = rng.choice(REFS).replace("{n}", str(rng.randint(1000, 9999)))
    day, day2 = rng.sample(DAYS, 2)
    return template.format(
        name=rng.choice(NAMES),
        name2=rng.choice(NAMES),
        company=rng.choice(COMPANIES),
        team=rng.choice(TEAMS),
        day=day,
        day2=day2,
        time=rng.choice(TIMES),
        deadline=rng.choice(DEADLINES),
        doc=rng.choice(DOCS),
        ref=ref,
    )


def generate(n: int = 400, seed: int = SEED) -> pd.DataFrame:
    rng = random.Random(seed)
    rows = []
    kinds = list(BODIES)

    for _ in range(n):
        kind = rng.choice(kinds)
        subject = _fill(rng.choice(SUBJECTS[kind]), rng)
        opener = _fill(rng.choice(OPENERS), rng)
        body = _fill(rng.choice(BODIES[kind]), rng)
        signoff = f"{rng.choice(SIGNOFFS)} {rng.choice(NAMES)}"
        text = f"{subject} {opener} {body} {signoff}"
        rows.append({"text": " ".join(text.split()), "label": 0, "source": "work_ham"})

    return pd.DataFrame(rows).drop_duplicates(subset="text").reset_index(drop=True)


def main() -> None:
    df = generate()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print(f"wrote {OUT}")
    print(f"  unique business emails: {len(df)}")
    print("\nsamples:\n")
    for i in range(3):
        print(" ", df.iloc[i]["text"][:150], "…")


if __name__ == "__main__":
    main()
