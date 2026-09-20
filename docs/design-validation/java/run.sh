#!/usr/bin/env bash
# Compile-and-use check for the T22 (JSON -> Java) board outputs.
#
#   pojo/   Order.java + Owner.java exactly as the POJO board shows them
#           (uses Lombok @Data, so Lombok is a required dependency)
#   record/ Order.java + Owner.java exactly as the record board shows them
#           (Java 16+, no Lombok)
#
# Neither variant performs network access.
#
# Usage:  ./run.sh [lombok-jar]
#
# Notes on toolchains:
#   * record/ needs JDK 16+ (records). Verified on JDK 24.0.2 and JDK 19.0.2.
#   * pojo/ needs Lombok on the compile classpath. Verified on JDK 11 (no extra
#     flags) and JDK 24 (-proc:full required: JDK 23+ no longer runs annotation
#     processors implicitly).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

LOMBOK="${1:-$HOME/.m2/repository/org/projectlombok/lombok/1.18.46/lombok-1.18.46.jar}"

fail=0

echo "=================== record (Java 16+, no Lombok) ==================="
if [ "$(javac -version 2>&1 | sed 's/.* //' | cut -d. -f1)" -lt 16 ] 2>/dev/null; then
  echo "SKIP: javac is older than 16, records are not supported."
else
  rm -rf record/out && mkdir -p record/out
  if javac -encoding UTF-8 -d record/out record/com/devkit/model/*.java record/Verify.java; then
    java -cp record/out Verify input.json || fail=1
  else
    echo "FAIL: record/ did not compile"; fail=1
  fi
fi

echo
echo "=================== POJO (Lombok @Data) ==================="
if [ ! -f "$LOMBOK" ]; then
  echo "SKIP: Lombok jar not found at $LOMBOK"
  echo "      pass the path explicitly: ./run.sh /path/to/lombok.jar"
  fail=1
else
  # -proc:full is required on JDK 23+; it is accepted as a no-op on older JDKs
  # that support the flag, and ignored where the older -proc:none default applies.
  PROCFLAG="-proc:full"
  rm -rf pojo/out && mkdir -p pojo/out
  if javac -encoding UTF-8 $PROCFLAG -cp "$LOMBOK" -d pojo/out \
       pojo/com/devkit/model/*.java pojo/Verify.java; then
    java -cp "pojo/out:$LOMBOK" Verify input.json || fail=1
  else
    echo "FAIL: pojo/ did not compile"; fail=1
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
fi
exit "$fail"
