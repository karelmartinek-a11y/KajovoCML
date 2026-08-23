# Resolve the certbot lineage that owns the canonical wildcard certificate.
#
# The runtime certificate path is an operational handoff target and is not
# necessarily the certbot lineage path. Older installations may have copied
# the certificate into a differently named live directory after certbot
# renamed the actual lineage. Never guess from the target directory when a
# renewal configuration is available.

resolve_certbot_lineage_name() {
  local certificate_path="${1:?certificate path required}"
  local certbot_root="${KCML_CERTBOT_ROOT:-/etc/letsencrypt}"
  local base_domain="${KCML_CERTBOT_BASE_DOMAIN:-${PUBLIC_BASE_DOMAIN:-hcasc.cz}}"
  local component_suffix="${KCML_CERTBOT_COMPONENT_SUFFIX:-kajovocml.${base_domain}}"
  local requested="${KCML_CERTBOT_CERT_NAME:-}"
  local candidate renewal_file lineage_path configured_fingerprint lineage_fingerprint
  local match="" match_count=0

  if [ -n "$requested" ]; then
    case "$requested" in
      *[!a-zA-Z0-9._-]*)
        echo "invalid certbot lineage name" >&2
        return 1
        ;;
    esac
    test -f "$certbot_root/renewal/$requested.conf"
    printf '%s\n' "$requested"
    return 0
  fi

  # Prefer the lineage encoded directly in the configured certbot path when
  # it still has a renewal configuration.
  case "$certificate_path" in
    "$certbot_root/live/"*/fullchain.pem)
      candidate="${certificate_path#"$certbot_root/live/"}"
      candidate="${candidate%/fullchain.pem}"
      case "$candidate" in
        ""|*[!a-zA-Z0-9._-]*) ;;
        *)
          if [ -f "$certbot_root/renewal/$candidate.conf" ]; then
            printf '%s\n' "$candidate"
            return 0
          fi
          ;;
      esac
      ;;
  esac

  # A runtime pair may have been copied out of the certbot live tree. Identify
  # its owner by certificate fingerprint first; this never reveals key or
  # certificate material.
  configured_fingerprint=""
  if [ -s "$certificate_path" ]; then
    configured_fingerprint="$(openssl x509 -in "$certificate_path" -noout -fingerprint -sha256 2>/dev/null || true)"
  fi
  if [ -n "$configured_fingerprint" ]; then
    for renewal_file in "$certbot_root"/renewal/*.conf; do
      [ -f "$renewal_file" ] || continue
      candidate="${renewal_file##*/}"
      candidate="${candidate%.conf}"
      lineage_path="$certbot_root/live/$candidate/fullchain.pem"
      [ -s "$lineage_path" ] || continue
      lineage_fingerprint="$(openssl x509 -in "$lineage_path" -noout -fingerprint -sha256 2>/dev/null || true)"
      if [ -n "$lineage_fingerprint" ] && [ "$lineage_fingerprint" = "$configured_fingerprint" ]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
  fi

  # Finally find the unique renewal lineage covering the canonical wildcard
  # SAN contract. Ambiguity fails closed instead of renewing an arbitrary
  # certificate on a shared nginx host.
  for renewal_file in "$certbot_root"/renewal/*.conf; do
    [ -f "$renewal_file" ] || continue
    candidate="${renewal_file##*/}"
    candidate="${candidate%.conf}"
    lineage_path="$certbot_root/live/$candidate/fullchain.pem"
    [ -s "$lineage_path" ] || continue
    if openssl x509 -in "$lineage_path" -noout -text 2>/dev/null \
      | grep -Fq "DNS:$base_domain" \
      && openssl x509 -in "$lineage_path" -noout -text 2>/dev/null \
      | grep -Fq "DNS:*.$base_domain" \
      && openssl x509 -in "$lineage_path" -noout -text 2>/dev/null \
      | grep -Fq "DNS:*.$component_suffix"; then
      match="$candidate"
      match_count=$((match_count + 1))
    fi
  done
  if [ "$match_count" -eq 1 ]; then
    printf '%s\n' "$match"
    return 0
  fi
  if [ "$match_count" -gt 1 ]; then
    echo "ambiguous canonical certbot wildcard lineage" >&2
    return 1
  fi

  # Fresh installations use this stable requested name. The caller still
  # verifies certbot's result and the SAN/key contract before activation.
  printf '%s\n' "kcml-wildcards"
}
