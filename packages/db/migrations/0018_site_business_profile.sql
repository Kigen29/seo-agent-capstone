-- The Google Business Profile a site belongs to, as its two public identifiers.
--
-- Stored rather than derived, like `brand` before it. Nothing in a site's markup names its
-- profile: the CID and the Place ID live in Google's index, and the only place a client can get
-- them is the Share button in Maps. Once stored, they are what a `hasMap` link, a `sameAs` link
-- and a "leave a review" link are built from, which is the difference between telling a client
-- their schema is thin and opening the pull request that fixes it.
--
-- The CID is text, not a bigint, and that is deliberate: it is an opaque identifier rather than a
-- quantity, nothing will ever do arithmetic on it, and it is routinely larger than 2^53, so any
-- path that touched it as a JavaScript number would round it silently.
--
-- Both nullable. A site with no profile connected reports the local axis as unmeasured and says
-- which field is missing, the same three-state honesty the other axes use.
ALTER TABLE "sites" ADD COLUMN "gbp_cid" text;
ALTER TABLE "sites" ADD COLUMN "gbp_place_id" text;
