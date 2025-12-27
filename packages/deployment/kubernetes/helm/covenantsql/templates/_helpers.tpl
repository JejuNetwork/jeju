{{/*
Expand the name of the chart.
*/}}
{{- define "eqlite.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "eqlite.fullname" -}}
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
{{- define "eqlite.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "eqlite.labels" -}}
helm.sh/chart: {{ include "eqlite.chart" . }}
{{ include "eqlite.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "eqlite.selectorLabels" -}}
app.kubernetes.io/name: {{ include "eqlite.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Block Producer labels
*/}}
{{- define "eqlite.bpLabels" -}}
{{ include "eqlite.labels" . }}
app.kubernetes.io/component: block-producer
{{- end }}

{{/*
Block Producer selector labels
*/}}
{{- define "eqlite.bpSelectorLabels" -}}
{{ include "eqlite.selectorLabels" . }}
app.kubernetes.io/component: block-producer
{{- end }}

{{/*
Miner labels
*/}}
{{- define "eqlite.minerLabels" -}}
{{ include "eqlite.labels" . }}
app.kubernetes.io/component: miner
{{- end }}

{{/*
Miner selector labels
*/}}
{{- define "eqlite.minerSelectorLabels" -}}
{{ include "eqlite.selectorLabels" . }}
app.kubernetes.io/component: miner
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "eqlite.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "eqlite.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
