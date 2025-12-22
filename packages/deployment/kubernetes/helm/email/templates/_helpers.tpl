{{/*
Expand the name of the chart.
*/}}
{{- define "jeju-email.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "jeju-email.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "jeju-email.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "jeju-email.labels" -}}
helm.sh/chart: {{ include "jeju-email.chart" . }}
{{ include "jeju-email.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "jeju-email.selectorLabels" -}}
app.kubernetes.io/name: {{ include "jeju-email.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "jeju-email.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "jeju-email.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Relay component labels
*/}}
{{- define "jeju-email.relay.labels" -}}
{{ include "jeju-email.labels" . }}
app.kubernetes.io/component: relay
{{- end }}

{{/*
Relay selector labels
*/}}
{{- define "jeju-email.relay.selectorLabels" -}}
{{ include "jeju-email.selectorLabels" . }}
app.kubernetes.io/component: relay
{{- end }}

{{/*
IMAP component labels
*/}}
{{- define "jeju-email.imap.labels" -}}
{{ include "jeju-email.labels" . }}
app.kubernetes.io/component: imap
{{- end }}

{{/*
IMAP selector labels
*/}}
{{- define "jeju-email.imap.selectorLabels" -}}
{{ include "jeju-email.selectorLabels" . }}
app.kubernetes.io/component: imap
{{- end }}

{{/*
SMTP component labels
*/}}
{{- define "jeju-email.smtp.labels" -}}
{{ include "jeju-email.labels" . }}
app.kubernetes.io/component: smtp
{{- end }}

{{/*
SMTP selector labels
*/}}
{{- define "jeju-email.smtp.selectorLabels" -}}
{{ include "jeju-email.selectorLabels" . }}
app.kubernetes.io/component: smtp
{{- end }}

{{/*
Bridge component labels
*/}}
{{- define "jeju-email.bridge.labels" -}}
{{ include "jeju-email.labels" . }}
app.kubernetes.io/component: bridge
{{- end }}

{{/*
Bridge selector labels
*/}}
{{- define "jeju-email.bridge.selectorLabels" -}}
{{ include "jeju-email.selectorLabels" . }}
app.kubernetes.io/component: bridge
{{- end }}

{{/*
Secret name
*/}}
{{- define "jeju-email.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "jeju-email.fullname" . }}-secrets
{{- end }}
{{- end }}
