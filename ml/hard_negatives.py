"""Generate legitimate security/IT emails — the class the corpora are missing.

The SpamAssassin ham used as the negative class is 2002-era mailing lists and
newsletters. It contains almost no ordinary corporate security mail, so in the
training data every message that mentions accounts, passwords or verification is
phishing. The model duly learned "security vocabulary => attack", and flags
genuine IT notices with high confidence.

This module produces the missing counter-examples: real-shaped security notices,
2FA reminders, sign-in alerts and policy updates that are entirely legitimate.
They are built combinatorially from many independent slots rather than a handful
of templates, so the model learns the *register* of legitimate security mail
rather than memorising a few fixed sentences.

These are SYNTHETIC. That is a real limitation, documented in ml/README.md: the
model can only learn the patterns represented here, and a legitimate style not
covered will still be misread. The honest fix is a corpus of real modern mail;
this is the best available substitute offline.

Run:  python hard_negatives.py       -> writes data/hard_negatives.csv
"""
import random
from pathlib import Path

import pandas as pd

OUT = Path(__file__).parent / "data" / "hard_negatives.csv"
SEED = 42

FIRST_NAMES = [
    "Priya", "Daniel", "Sarah", "Ahmed", "Maria", "James", "Wei", "Fatima",
    "Carlos", "Anna", "Rehan", "Thomas", "Yuki", "Olivia", "Ravi", "Sofia",
]
SENDERS = [
    "IT Support Team", "Information Security", "the IT Helpdesk", "IT Operations",
    "the Security Team", "Workplace Technology", "Corporate IT", "the InfoSec team",
]
COMPANIES = [
    "Northwind", "Acme", "Contoso", "Fabrikam", "Globex", "Initech",
    "Umbrella Systems", "Stark Industries", "Wayne Enterprises", "Hooli",
]
DEADLINES = [
    "by Friday", "before the end of the month", "within the next two weeks",
    "by 31 March", "before your next login", "at your convenience",
    "during this quarter", "by the end of next week",
]

# The tell of a legitimate security email: it tells you NOT to share secrets,
# and points at a route you already trust rather than a link it supplies.
REASSURANCES = [
    "You do not need to send your password or any verification codes to the IT team.",
    "We will never ask you for your password, PIN or one-time code by email.",
    "Our staff will never request your credentials over email or phone.",
    "Please remember that we never ask for passwords in email correspondence.",
    "No one from IT will ever ask you to share your authentication code.",
    "If anyone asks you for your password by email, report it to security immediately.",
]
SAFE_ROUTES = [
    "Please open the company portal through your usual bookmarked link",
    "Sign in the way you normally do, via the intranet homepage",
    "Access the settings page directly from the app you already use",
    "Navigate to the portal yourself rather than following a link in email",
    "Use the desktop shortcut your device was set up with",
    "Open the internal dashboard from your browser bookmarks",
]
NO_ACTION = [
    "If you have already completed this, no further action is required.",
    "If this was you, there is nothing further to do.",
    "You can ignore this message if you have already updated your details.",
    "No response is needed if everything looks correct.",
    "This is a routine notice and usually requires no action.",
]

SUBJECTS = {
    "review": [
        "Quarterly security review",
        "Annual account security check",
        "Scheduled review of account settings",
        "Reminder: security settings review",
    ],
    "mfa": [
        "Enable two-factor authentication",
        "Multi-factor authentication rollout",
        "Action recommended: turn on 2FA",
        "Two-step verification is now available",
    ],
    "signin": [
        "New sign-in to your account",
        "Sign-in from a new device",
        "Security alert: new device signed in",
        "Recent login notification",
    ],
    "policy": [
        "Updated password policy",
        "Changes to our security policy",
        "New IT security guidelines",
        "Security policy update for all staff",
    ],
    "maintenance": [
        "Scheduled maintenance this weekend",
        "Planned downtime for the identity service",
        "Upcoming single sign-on migration",
        "System upgrade notice",
    ],
    "bank": [
        "Important information about your card",
        "We have replaced your debit card",
        "A change to your account details",
        "Notice about recent card activity",
    ],
    "breach": [
        "Notice of a data incident",
        "Information about a third-party security incident",
        "Important notice regarding your data",
        "Security incident notification",
    ],
    "receipt": [
        "Your receipt from {company}",
        "Payment confirmation",
        "Your subscription renews soon",
        "Invoice for this month",
    ],
}

BODIES = {
    "review": [
        "As part of our {cadence} security review, {sender} is asking all employees to "
        "review their account security settings {deadline}.\n\n{route} and confirm that "
        "your recovery email and phone number are still correct. {reassurance}\n\n"
        "We are also reminding employees to enable two-factor authentication if it is "
        "not already active.\n\n{no_action}",

        "It is time for the {cadence} review of account access at {company}. Please take "
        "a few minutes {deadline} to check that the contact details on your profile are "
        "current.\n\n{route}. {reassurance}\n\n{no_action}",
    ],
    "mfa": [
        "{company} is rolling out two-factor authentication for all staff accounts. "
        "Enabling it {deadline} adds a second check when you sign in from a new device."
        "\n\n{route} and follow the Security section to register your device. "
        "{reassurance}\n\n{no_action}",

        "Two-step verification is now available on your work account. We strongly "
        "recommend turning it on {deadline}.\n\n{route}, open Security settings, and "
        "choose an authenticator app or hardware key. {reassurance}",
    ],
    "signin": [
        "We noticed a sign-in to your {company} account from a new device.\n\n"
        "Device: {device}\nLocation: {location}\nTime: {time}\n\n"
        "If this was you, no action is needed. If you do not recognise this activity, "
        "{route} and change your password from the Security page. {reassurance}",

        "Your account was accessed from a device we have not seen before "
        "({device}, {location}). This is a routine notification.\n\n{no_action} "
        "If it was not you, contact {sender} through the helpdesk number on the "
        "intranet. {reassurance}",
    ],
    "policy": [
        "{sender} has updated the password policy for {company}. From next month, "
        "passwords must be at least 14 characters and will no longer expire on a fixed "
        "schedule.\n\nThe full policy is on the intranet. {route} to read it. "
        "{reassurance}\n\n{no_action}",

        "We are simplifying our security guidelines. Passphrases are now preferred over "
        "complex short passwords, and routine 90-day rotation is being retired.\n\n"
        "Nothing changes for you today; your current password keeps working. {reassurance}",
    ],
    "bank": [
        "We are writing to let you know that we have replaced your card ending "
        "{last4} as a precaution following a merchant data breach. Your new card "
        "will arrive within five working days.\n\nThere is no need to contact us "
        "and your account remains protected. {reassurance}",

        "We have blocked a transaction on your card ending {last4} that did not "
        "match your usual pattern. If it was you, the payment will go through on "
        "your next attempt.\n\n{no_action} If it was not you, call the number on "
        "the back of your card. {reassurance}",
    ],
    "breach": [
        "On {date} we detected unauthorised access to a third-party vendor system "
        "that held customer email addresses. Passwords and payment details were "
        "not affected.\n\nAs a precaution we recommend changing your password "
        "{deadline} through the app. We are contacting all affected customers "
        "directly and have notified the regulator. {reassurance}",

        "We are writing to tell you about a security incident at {company}. A "
        "limited set of account records was exposed on {date}. No financial data "
        "was involved.\n\n{route} to review recent activity on your account. "
        "{reassurance}\n\n{no_action}",
    ],
    "maintenance": [
        "The identity service will be unavailable for scheduled maintenance {deadline}. "
        "During the window you may be asked to sign in again.\n\n"
        "No settings will change and you do not need to do anything in advance. "
        "{reassurance}\n\n{no_action}",

        "We are migrating {company} to single sign-on {deadline}. Afterwards you will "
        "sign in once and reach all internal tools without re-entering your password."
        "\n\n{route} if you want to review your linked devices beforehand. {reassurance}",
    ],
    "receipt": [
        "Thanks for your payment. Your {company} subscription has renewed and the "
        "receipt is attached for your records.\n\nAmount: {amount}\nCard ending: "
        "{last4}\nNext renewal: {date}\n\n{no_action} You can change your plan or "
        "cancel at any time from your account page. {reassurance}",

        "Your invoice for this month is ready. The total is {amount}, charged to the "
        "card ending {last4} on {date}.\n\n{route} to download a PDF copy or update "
        "your billing details. {reassurance}",
    ],
}

DEVICES = ["Windows 11 · Chrome", "macOS · Safari", "iPhone · Mail", "Android · Chrome",
           "Ubuntu · Firefox", "iPad · Safari"]
LOCATIONS = ["London, UK", "Mumbai, IN", "Berlin, DE", "Toronto, CA", "Austin, US",
             "Singapore, SG", "Dublin, IE"]
TIMES = ["today at 09:14", "yesterday at 18:42", "Monday at 07:55", "this morning at 11:20"]
CADENCES = ["quarterly", "annual", "half-yearly", "periodic", "routine"]
LAST4 = ["4412", "8830", "1207", "6654", "9021", "3388"]
DATES = ["2 March", "14 January", "27 September", "8 June", "19 November"]
AMOUNTS = ["$9.99", "$14.00", "£12.50", "€19.99", "$49.00", "£7.99"]


def generate(n: int = 1400, seed: int = SEED) -> pd.DataFrame:
    rng = random.Random(seed)
    rows = []
    kinds = list(SUBJECTS)

    for _ in range(n):
        kind = rng.choice(kinds)
        subject = rng.choice(SUBJECTS[kind]).replace("{company}", rng.choice(COMPANIES))
        body = rng.choice(BODIES[kind]).format(
            sender=rng.choice(SENDERS),
            company=rng.choice(COMPANIES),
            deadline=rng.choice(DEADLINES),
            reassurance=rng.choice(REASSURANCES),
            route=rng.choice(SAFE_ROUTES),
            no_action=rng.choice(NO_ACTION),
            cadence=rng.choice(CADENCES),
            device=rng.choice(DEVICES),
            location=rng.choice(LOCATIONS),
            time=rng.choice(TIMES),
            last4=rng.choice(LAST4),
            date=rng.choice(DATES),
            amount=rng.choice(AMOUNTS),
        )
        greeting = f"Hi {rng.choice(FIRST_NAMES)},"
        signoff = rng.choice(["Thanks,", "Regards,", "Best regards,", "Kind regards,"])
        signer = f"{rng.choice(FIRST_NAMES)}\n{rng.choice(SENDERS)}"

        text = f"{subject}\n\n{greeting}\n\n{body}\n\n{signoff}\n{signer}"
        rows.append({"text": " ".join(text.split()), "label": 0, "source": "legit_security"})

    return pd.DataFrame(rows).drop_duplicates(subset="text").reset_index(drop=True)


def main() -> None:
    df = generate()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print(f"wrote {OUT}")
    print(f"  unique legitimate security emails: {len(df)}")
    print("\nsample:\n")
    print(df.iloc[0]["text"][:400], "…")


if __name__ == "__main__":
    main()
