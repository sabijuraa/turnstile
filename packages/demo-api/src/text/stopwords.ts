/** Common English function words. They carry little topic signal, so they get no weight. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  `a about above after again against all almost also although am among an and another any are
  aren't around as at away be because been before being below between both but by can can't
  cannot could couldn't did didn't do does doesn't doing don't done down during each either else
  enough even ever every few for from further get gets got had hadn't has hasn't have haven't
  having he he'd he'll he's her here here's hers herself him himself his how how's however i i'd
  i'll i'm i've if in into is isn't it it's its itself just least less let's like made make many
  may me might more most much must mustn't my myself neither never no none nor not now of off often on
  once one only or other others otherwise ought our ours ourselves out over own per perhaps quite
  rather really said same say says shall shan't she she'd she'll she's should shouldn't since so
  some still such than that that's the their theirs them themselves then there there's therefore
  these they they'd they'll they're they've thing things this those though through thus to too
  toward towards under until up upon us used very was wasn't we we'd we'll we're we've well were
  weren't what what's whatever when when's where where's whether which while who who's whom whose
  why why's will with within without won't would wouldn't yet you you'd you'll you're you've your
  yours yourself yourselves`.split(/\s+/),
);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}
