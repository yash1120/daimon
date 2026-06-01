"""Profiles of the philosophers for the web 'About' section.

Facts (dates, schools, work titles) and the idea summaries are written here in
our own words. Verbatim quotes are included ONLY for the public-domain authors
(Seneca, Marcus Aurelius, Nietzsche); for Camus and Weil — whose translations
remain under copyright — we summarise the ideas instead of quoting.
"""

ABOUT: dict[str, dict] = {
    "seneca": {
        "dates": "c. 4 BC - AD 65",
        "school": "Roman Stoicism",
        "essence": "Stoic statesman who taught that philosophy is for living, not display.",
        "bio": (
            "Roman Stoic philosopher, statesman, and dramatist, and for a time the "
            "tutor and adviser of the emperor Nero. In letters and essays he turned "
            "Stoic theory into practical counsel on time, mortality, anger, and the "
            "good life. Implicated in a plot and ordered by Nero to die in AD 65, he "
            "met his end with the composure he had urged on others."
        ),
        "ideas": [
            "Time is the only thing truly ours - guard it",
            "Rehearse misfortune in advance, so it cannot ambush you",
            "Anger is a brief madness",
            "The wise person needs little to be content",
        ],
        "works": [
            "Letters from a Stoic (Epistulae Morales)",
            "On the Shortness of Life",
            "On Anger",
            "On the Happy Life",
        ],
        "quote": "It is not that we have a short time to live, but that we waste a great deal of it.",
    },
    "aurelius": {
        "dates": "AD 121 - 180",
        "school": "Roman Stoicism",
        "essence": "The philosopher-emperor who wrote a private notebook to himself.",
        "bio": (
            "Roman emperor from 161 to 180 and a Stoic whose 'Meditations' were never "
            "meant for publication. Written on campaign, they are a working manual of "
            "self-discipline, duty, and acceptance of nature's order - the most "
            "powerful man in the world reminding himself, each day, to remain good."
        ),
        "ideas": [
            "Confine yourself to the present moment",
            "You control your mind, not outside events",
            "What stands in the way becomes the way",
            "Remember you will die - let it sharpen, not sadden",
        ],
        "works": ["Meditations"],
        "quote": "The happiness of your life depends upon the quality of your thoughts.",
    },
    "nietzsche": {
        "dates": "1844 - 1900",
        "school": "19th-century German philosophy",
        "essence": "Diagnosed the death of God and asked how to create meaning without it.",
        "bio": (
            "German philosopher and philologist who declared that the cultural belief "
            "in God had collapsed, and asked how humanity might create its own values "
            "in the void. Through aphorism and provocation he attacked herd morality "
            "and championed self-overcoming, the will to power, and amor fati. A "
            "breakdown in 1889 ended his working life; his thought reshaped modern "
            "philosophy, psychology, and art."
        ),
        "ideas": [
            "The will to power",
            "Eternal recurrence - could you will this life again, endlessly?",
            "Amor fati - love your fate",
            "Become who you are",
            "Master morality vs. herd morality",
        ],
        "works": [
            "Thus Spoke Zarathustra",
            "Beyond Good and Evil",
            "The Gay Science",
            "On the Genealogy of Morals",
            "Twilight of the Idols",
        ],
        "quote": "That which does not kill us makes us stronger.",
    },
    "camus": {
        "dates": "1913 - 1960",
        "school": "Absurdism",
        "essence": "Asked whether life is worth living without meaning - and answered with revolt.",
        "bio": (
            "French-Algerian writer and thinker and a Nobel laureate (1957), who named "
            "the 'absurd': the collision between our hunger for meaning and a silent "
            "universe. His answer was neither suicide nor false hope but lucid revolt, "
            "solidarity, and a sunlit love of life. Novelist, essayist, and "
            "journalist, he died in a car crash at 46."
        ),
        "ideas": [
            "The absurd - meaning sought, none given",
            "Revolt rather than resignation or false hope",
            "One must imagine Sisyphus happy",
            "Lucidity: face it without consolations",
            "From revolt grows solidarity",
        ],
        "works": [
            "The Myth of Sisyphus",
            "The Stranger",
            "The Plague",
            "The Rebel",
            "The Fall",
        ],
        "quote": None,
        "note": "Camus's writings remain under copyright, so his ideas are summarised here in our own words.",
    },
    "weil": {
        "dates": "1909 - 1943",
        "school": "Mystical & ethical philosophy",
        "essence": "Mystic of attention who shared the lot of factory workers and the afflicted.",
        "bio": (
            "French philosopher, mystic, and activist of fierce moral seriousness. "
            "Academically brilliant, she worked in factories and fields to share the "
            "condition of laborers, went to the Spanish Civil War, and aligned with "
            "the French Resistance. Her notebooks, published after her death at 34, "
            "treat attention as a form of prayer and affliction as a doorway to grace."
        ),
        "ideas": [
            "Attention is the rarest and purest generosity",
            "Gravity and grace - the forces of the soul",
            "Affliction (malheur) differs from mere suffering",
            "Decreation - undoing the self to make room for the good",
            "The dignity of labour; the need for roots",
        ],
        "works": [
            "Gravity and Grace",
            "The Need for Roots",
            "Waiting for God",
        ],
        "quote": None,
        "note": "Weil's writings remain under copyright, so her ideas are summarised here in our own words.",
    },
}
