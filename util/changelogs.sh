#!/bin/bash

# tags sorted semver style
TAGS=($(git tag -l | sort -k1,1n -k2,2n -k3,3n -t.))

TO=(${TAGS[@]})

FROM=(`git rev-list --max-parents=0 HEAD`)
FROM+=(${TAGS[@]:0:$((${#TAGS[@]}-1))})

for i in ${!FROM[@]}; do
  echo "### ${TO[$i]}"
  git log --reverse ${FROM[$i]}..${TO[$i]} --pretty="- %s ([commit](https://github.com/Polymer/vulcanize/commit/%h))"
done
