{{/*
Expand the name of the chart.
*/}}
{{- define "jk-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name (63 char limit per DNS).
*/}}
{{- define "jk-api.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version as used by the chart label.
*/}}
{{- define "jk-api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "jk-api.labels" -}}
helm.sh/chart: {{ include "jk-api.chart" . }}
{{ include "jk-api.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: jk-platform
{{- end }}

{{/*
Selector labels (stable across upgrades — never add versions here).
*/}}
{{- define "jk-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "jk-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "jk-api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "jk-api.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Digest-pinned image reference. Fails the render when no digest is provided:
images are promoted by immutable digest only (Appendix H.3 / Appendix I).
*/}}
{{- define "jk-api.image" -}}
{{- $digest := required "image.digest is required (sha256:... — images are promoted by immutable digest, never by tag)" .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository $digest }}
{{- end }}
